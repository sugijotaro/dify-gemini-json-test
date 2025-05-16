import 'dotenv/config';
import { GoogleGenAI, createUserContent, createPartFromUri, Type } from '@google/genai';
import fs from 'fs';
import path from 'path';
import mime from 'mime-types';
import ffmpeg from 'fluent-ffmpeg';
// @ts-ignore
import ffprobe from 'ffprobe-static';
import { spawn } from 'child_process';

const MAX_PARALLEL_UPLOADS = 4;
const MAX_PARALLEL_ANALYSIS = 4;

ffmpeg.setFfprobePath(ffprobe.path);

async function ensureOutputDir() {
  const outputDir = path.join(process.cwd(), 'output');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir);
  }
  return outputDir;
}

async function uploadFile(ai: GoogleGenAI, filePath: string, localName: string) {
  let mimeType = mime.lookup(filePath) || '';
  if (mimeType === 'application/mp4') {
    mimeType = 'video/mp4';
  }
  if (!mimeType) {
    console.warn(`Skipped (unknown mime): ${localName}`);
    return null;
  }
  const fileSizeBytes = fs.statSync(filePath).size;
  const fileSizeMB = fileSizeBytes / (1024 * 1024);
  const startTime = Date.now();
  console.log(`[UPLOAD] Start: ${localName} (${fileSizeMB.toFixed(2)} MB)`);
  try {
    const myfile = await ai.files.upload({
      file: filePath,
      config: { mimeType: mimeType as string },
    });
    const endTime = Date.now();
    const durationSec = (endTime - startTime) / 1000;
    console.log(`[UPLOAD] Done:  ${localName} (${fileSizeMB.toFixed(2)} MB, ${durationSec.toFixed(2)} sec)`);
    return {
      name: myfile.name ?? '',
      localName,
      uri: myfile.uri ?? '',
      mimeType: myfile.mimeType ?? '',
      fileSizeMB,
      uploadDuration: durationSec,
    };
  } catch (err: any) {
    console.error(`[UPLOAD] Failed: ${localName}:`, err?.message || err);
    return null;
  }
}

async function waitForActive(ai: GoogleGenAI, fileName: string, localName: string) {
  const maxWaitMs = 30000;
  const pollIntervalMs = 2000;
  let waited = 0;
  let fileState = '';
  let count = 0;
  while (waited < maxWaitMs) {
    count++;
    const fileInfo = await ai.files.get({ name: fileName });
    fileState = fileInfo.state ?? '';
    if (fileState === 'ACTIVE') {
      process.stdout.write(`\r[WAIT] ${localName}: ACTIVEになりました（${(waited/1000).toFixed(1)}秒待機, ${count}回目リクエスト）\n`);
      return true;
    }
    process.stdout.write(`\r[WAIT] ${localName}: ${count}回目, ${(waited/1000).toFixed(1)}秒待機中 (current state: ${fileState})`);
    await new Promise((res) => setTimeout(res, pollIntervalMs));
    waited += pollIntervalMs;
  }
  process.stdout.write(`\n`);
  return false;
}

async function analyzeFile(ai: GoogleGenAI, file: { uri: string; mimeType: string; localName: string; name: string; fileSizeMB: number; uploadDuration: number }, outputDir: string, videoPath: string) {
  const startTime = Date.now();
  console.log(`[ANALYZE] Start: ${file.localName}`);
  try {
    const ok = await waitForActive(ai, file.name, file.localName);
    if (!ok) {
      console.error(`[ANALYZE] File not ACTIVE: ${file.localName}`);
      return;
    }
    // 動画長取得
    const { seconds: videoSeconds, mmss: videoMMSS } = await getVideoDuration(videoPath);
    const response = await ai.models.generateContent({
      model: 'gemini-2.0-flash',
      contents: createUserContent([
        createPartFromUri(file.uri, file.mimeType),
        'この動画をクリップごとに分割し、各クリップの開始時刻・終了時刻（MM:SS形式）、日本語でタイトル、重要度（1=高、2=中、3=低）を抽出し、clips配列として構造化JSONで出力してください。',
      ]),
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            clips: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  start_time: { type: Type.STRING, description: 'クリップの開始時刻（MM:SS形式）' },
                  end_time:   { type: Type.STRING, description: 'クリップの終了時刻（MM:SS形式）' },
                  name:       { type: Type.STRING, description: '日本語でクリップのタイトル' },
                  importance: { type: Type.INTEGER, description: '重要度（1=高、2=中、3=低）' },
                },
                required: ['start_time', 'end_time', 'name', 'importance'],
                propertyOrdering: ['start_time', 'end_time', 'name', 'importance'],
              },
            },
          },
          required: ['clips'],
          propertyOrdering: ['clips'],
        },
      },
    });
    // clips検証・修正
    let json: any;
    try {
      json = JSON.parse(response.text ?? '');
    } catch (e) {
      throw new Error(`[ANALYZE] Invalid JSON for ${file.localName}`);
    }
    if (!json.clips || !Array.isArray(json.clips)) {
      throw new Error(`[ANALYZE] No clips array in result for ${file.localName}`);
    }
    // MM:SS→秒変換
    function mmssToSeconds(mmss: string): number {
      const [m, s] = mmss.split(':').map(Number);
      return m * 60 + s;
    }
    // 範囲チェック・修正
    let clips = json.clips;
    // 1. 00:00でなければ修正
    if (clips.length > 0 && clips[0].start_time !== '00:00') {
      clips[0].start_time = '00:00';
    }
    // 2. 最後のend_timeが動画長と違ったら修正
    if (clips.length > 0 && clips[clips.length-1].end_time !== videoMMSS) {
      clips[clips.length-1].end_time = videoMMSS;
    }
    // 3. 範囲外チェック
    for (const c of clips) {
      if (mmssToSeconds(c.start_time) < 0 || mmssToSeconds(c.end_time) > Math.ceil(videoSeconds)) {
        throw new Error(`[ANALYZE] Clip time out of range in ${file.localName}: ${c.start_time} - ${c.end_time} (動画長: ${videoMMSS})`);
      }
    }
    // 4. ギャップ検出・挿入
    let newClips = [];
    for (let i = 0; i < clips.length; i++) {
      newClips.push(clips[i]);
      if (i < clips.length - 1) {
        const endSec = mmssToSeconds(clips[i].end_time);
        const nextStartSec = mmssToSeconds(clips[i+1].start_time);
        if (nextStartSec > endSec) {
          // ギャップあり
          newClips.push({
            start_time: secondsToMMSS(endSec),
            end_time: secondsToMMSS(nextStartSec),
            name: 'ギャップ',
            importance: 3
          });
        }
      }
    }
    clips = newClips;
    // 保存
    const outputPath = path.join(outputDir, `${file.localName}.json`);
    fs.writeFileSync(outputPath, JSON.stringify({ clips }, null, 2), 'utf-8');
    const endTime = Date.now();
    const durationSec = (endTime - startTime) / 1000;
    console.log(`[ANALYZE] Done:  ${file.localName} (${durationSec.toFixed(2)} sec) -> ${outputPath}`);
  } catch (err: any) {
    console.error(`[ANALYZE] Failed: ${file.localName}:`, err?.message || err);
    throw err;
  }
}

async function analyzeFileWithRetry(ai: GoogleGenAI, file: { uri: string; mimeType: string; localName: string; name: string; fileSizeMB: number; uploadDuration: number }, outputDir: string, videoPath: string, maxRetries = 3) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await analyzeFile(ai, file, outputDir, videoPath);
      return;
    } catch (err: any) {
      if (attempt < maxRetries) {
        console.warn(`[ANALYZE][RETRY] ${file.localName} (attempt ${attempt} failed, retrying...)`);
        await new Promise(res => setTimeout(res, 1000));
      } else {
        console.error(`[ANALYZE][FAILED] ${file.localName} (all ${maxRetries} attempts failed)`);
      }
    }
  }
}

async function deleteFile(ai: GoogleGenAI, fileName: string, localName: string) {
  try {
    await ai.files.delete({ name: fileName });
    console.log(`[DELETE] Deleted: ${localName} (${fileName})`);
  } catch (err: any) {
    console.error(`[DELETE] Failed: ${localName} (${fileName}):`, err?.message || err);
  }
}

async function parallelLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = [];
  const executing: Promise<void>[] = [];
  let idx = 0;
  async function run(item: T) {
    const res = await fn(item);
    results.push(res);
  }
  while (idx < items.length) {
    while (executing.length < limit && idx < items.length) {
      const p = run(items[idx++]).then(() => {
        executing.splice(executing.indexOf(p), 1);
      });
      executing.push(p);
    }
    await Promise.race(executing);
  }
  await Promise.all(executing);
  return results;
}

function secondsToMMSS(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

async function getVideoDuration(filePath: string): Promise<{ seconds: number, mmss: string }> {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err: Error | null, metadata: any) => {
      if (err) return reject(err);
      const duration = metadata.format.duration;
      if (!duration) return reject(new Error('Duration not found'));
      resolve({ seconds: duration, mmss: secondsToMMSS(duration) });
    });
  });
}

async function splitVideo(inputPath: string, outDir: string): Promise<string[]> {
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir);
  const { seconds: totalSeconds } = await getVideoDuration(inputPath);
  const baseName = path.basename(inputPath, path.extname(inputPath));
  const segmentLength = 600; // 10分
  let start = 0;
  let idx = 1;
  const outFiles: string[] = [];
  while (start < totalSeconds) {
    const end = Math.min(start + segmentLength, totalSeconds);
    const outName = `part${idx}_${baseName}_${start}-${Math.floor(end)}.mp4`;
    const outPath = path.join(outDir, outName);
    const minExpr = "%{eif\\:floor(t/60)\\:d\\:2}";
    const secExpr = "%{eif\\:mod(t\\,60)\\:d\\:2}";
    const drawtext = [
      "drawtext=fontfile=/System/Library/Fonts/Helvetica.ttc",
      // `text='${minExpr}:${secExpr}'`,
      `text='%{pts\\:hms}`,
      "x=(w-text_w)/2",
      "y=h-th-10",
      "fontcolor=white",
      "fontsize=48",
      "box=1",
      "boxcolor=black@0.5",
      "boxborderw=10"
    ].join(':');
    const vf = `scale=1280:720,fps=1,${drawtext}`;
    const ffmpegArgs = [
      '-loglevel', 'error',
      '-ss', start.toString(),
      '-i', inputPath,
      '-t', (end - start).toString(),
      '-vf', vf,
      '-c:v', 'libx264',
      '-preset', 'veryfast',
      '-crf', '32',
      '-c:a', 'aac',
      '-b:a', '64k',
      '-map', '0:v:0',
      '-map', '0:a:0?',
      '-y',
      '-progress', 'pipe:1',
      outPath
    ];
    await new Promise<void>((resolve, reject) => {
      let ffmpegError = '';
      let lastProgress = 0;
      const ffmpegProc = spawn('ffmpeg', ffmpegArgs);
      ffmpegProc.stderr.on('data', (data) => { ffmpegError += data.toString(); });
      ffmpegProc.stdout.on('data', (data) => {
        const lines = data.toString().split(/\r?\n/);
        for (const line of lines) {
          if (line.startsWith('out_time_ms=')) {
            const ms = parseInt(line.split('=')[1], 10);
            const percent = Math.min(100, (ms / ((end - start) * 1000000)) * 100);
            if (percent - lastProgress >= 5 || percent === 100) { // 5%ごとに表示
              process.stdout.write(`[SPLIT][${outName}] progress: ${percent.toFixed(1)}%\r`);
              lastProgress = percent;
            }
          }
        }
      });
      ffmpegProc.on('close', (code) => {
        process.stdout.write(`\r[SPLIT][${outName}] progress: 100.0%\n`);
        if (code === 0) {
          getVideoDuration(outPath).then(({ seconds }) => {
            process.stdout.write('\n');
            console.log(`[SPLIT] Created: ${outName} (${seconds.toFixed(2)} sec)`);
            resolve();
          }).catch(() => {
            process.stdout.write('\n');
            console.log(`[SPLIT] Created: ${outName} (duration unknown)`);
            resolve();
          });
          outFiles.push(outPath);
        } else {
          if (ffmpegError) console.error('[FFMPEG ERROR]', ffmpegError);
          reject(new Error(`ffmpeg exited with code ${code}`));
        }
      });
    });
    start = end;
    idx++;
  }
  return outFiles;
}

async function main(): Promise<void> {
  const totalStart = Date.now();
  console.log(`[START] ${new Date(totalStart).toLocaleString()}`);
  ffmpeg.setFfprobePath(ffprobe.path);
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error('GEMINI_API_KEY is not set in .env');
    process.exit(1);
  }

  const inputVideo = process.argv[2];
  if (!inputVideo) {
    console.error('Usage: npx tsx splitAndAnalyzeVideoMain.ts <video_path>');
    process.exit(1);
  }
  if (!fs.existsSync(inputVideo)) {
    console.error(`File not found: ${inputVideo}`);
    process.exit(1);
  }

  const splitDir = path.join(process.cwd(), 'split_clips');
  if (fs.existsSync(splitDir)) {
    fs.rmSync(splitDir, { recursive: true, force: true });
  }
  fs.mkdirSync(splitDir);

  console.log(`[SPLIT] Splitting video into 10min/720p/1fps clips...`);
  let splitFiles: string[] = [];
  try {
    splitFiles = await splitVideo(inputVideo, splitDir);
    console.log(`[SPLIT] Done. ${splitFiles.length} clips created.`);
  } catch (e) {
    console.error(`[SPLIT] Failed:`, e);
    process.exit(1);
  }

  // 既存パイプラインをsplitFilesに適用
  const files = splitFiles.map(f => path.basename(f));
  const ai = new GoogleGenAI({ apiKey });
  const outputDir = await ensureOutputDir();
  const uploadedFiles: Array<{ name: string; localName: string; uri: string; mimeType: string; fileSizeMB: number; uploadDuration: number }> = [];

  // 並列アップロード
  console.log(`[INFO] Uploading ${files.length} files with up to ${MAX_PARALLEL_UPLOADS} parallel uploads...`);
  const uploaded = await parallelLimit(
    files,
    MAX_PARALLEL_UPLOADS,
    async (localName) => {
      const filePath = path.join(splitDir, localName);
      return await uploadFile(ai, filePath, localName);
    }
  );
  for (const f of uploaded) if (f && f.name && f.uri && f.mimeType) uploadedFiles.push(f);

  // 並列分析
  console.log(`[INFO] Analyzing ${uploadedFiles.length} files with up to ${MAX_PARALLEL_ANALYSIS} parallel analyses...`);
  await parallelLimit(
    uploadedFiles,
    MAX_PARALLEL_ANALYSIS,
    async (file) => {
      const filePath = path.join(splitDir, file.localName);
      await analyzeFileWithRetry(ai, file, outputDir, filePath);
    }
  );

  // 分析後に削除
  console.log(`[INFO] Deleting uploaded files from server...`);
  await parallelLimit(
    uploadedFiles,
    MAX_PARALLEL_ANALYSIS,
    async (file) => {
      await deleteFile(ai, file.name, file.localName);
    }
  );

  // 一時ファイル削除
  // fs.rmSync(splitDir, { recursive: true, force: true });

  const totalEnd = Date.now();
  const totalDuration = (totalEnd - totalStart) / 1000;
  console.log(`\n[INFO] All done! Output dir: ${outputDir}`);
  console.log(`[INFO] Total elapsed: ${totalDuration.toFixed(2)} seconds`);
}

main();
