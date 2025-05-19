import path from 'path';
import fs from 'fs';
import { spawn } from 'child_process';

const __dirname = path.dirname(new URL(import.meta.url).pathname);

function getWorkDir(videoPath: string): string {
  const videoDir = path.dirname(videoPath);
  const videoBase = path.parse(videoPath).name;
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  const workDir = path.join(videoDir, `tmp_${videoBase}_${y}${m}${d}_${hh}${mm}`);
  if (!fs.existsSync(workDir)) fs.mkdirSync(workDir);
  return workDir;
}

async function runSplitAndAnalyze(videoPath: string, workDir: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn('npx', ['tsx', 'splitAndAnalyzeVideoMain.ts', videoPath, workDir], {
      cwd: __dirname,
      stdio: 'inherit',
      shell: true,
    });
    proc.on('close', (code) => {
      if (code === 0) {
        const mergedJson = path.join(workDir, 'output/merged_clips.json');
        if (!fs.existsSync(mergedJson)) {
          reject(new Error('merged_clips.json not found after splitAndAnalyzeVideoMain'));
        } else {
          resolve(mergedJson);
        }
      } else {
        reject(new Error('splitAndAnalyzeVideoMain failed'));
      }
    });
  });
}

async function runAutoGenerateXML(videoPath: string, clipsJsonPath: string, workDir: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const outputXml = path.join(workDir, `${path.parse(videoPath).name}_final.xml`);
    const minimalXml = path.join(__dirname, 'minimal.xml');
    const proc = spawn(
      'npx',
      [
        'tsx',
        'auto_generate_xml_allinone.ts',
        '--video', videoPath,
        '--clips', clipsJsonPath,
        '--output', outputXml,
        '--template', minimalXml,
        '--workdir', workDir
      ],
      {
        cwd: __dirname,
        stdio: 'inherit',
        shell: true,
      }
    );
    proc.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error('auto_generate_xml_allinone failed'));
      }
    });
  });
}

async function main() {
  const videoPath = process.argv[2];
  if (!videoPath) {
    console.error('Usage: npx tsx runAll.ts <video_path>');
    process.exit(1);
  }
  if (!fs.existsSync(videoPath)) {
    console.error(`File not found: ${videoPath}`);
    process.exit(1);
  }
  const workDir = getWorkDir(videoPath);
  try {
    console.log(`[STEP 1] Running splitAndAnalyzeVideoMain...`);
    const mergedClipsJson = await runSplitAndAnalyze(videoPath, workDir);
    console.log(`[STEP 2] Running auto_generate_xml_allinone...`);
    await runAutoGenerateXML(videoPath, mergedClipsJson, workDir);
    console.log(`[DONE] XML generated successfully.`);
    console.log(`[INFO] All outputs are in: ${workDir}`);
  } catch (e: any) {
    console.error('[ERROR]', e.message || e);
    process.exit(1);
  }
}

main(); 