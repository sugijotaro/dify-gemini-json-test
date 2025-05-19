import path from 'path';
import fs from 'fs';
import { spawn } from 'child_process';

const __dirname = path.dirname(new URL(import.meta.url).pathname);

async function runSplitAndAnalyze(videoPath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn('npx', ['tsx', 'splitAndAnalyzeVideoMain.ts', videoPath], {
      cwd: __dirname,
      stdio: 'inherit',
      shell: true,
    });
    proc.on('close', (code) => {
      if (code === 0) {
        const mergedJson = path.join(__dirname, '../output/merged_clips.json');
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

async function runAutoGenerateXML(videoPath: string, clipsJsonPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const outputXml = path.join(path.dirname(videoPath), `${path.parse(videoPath).name}_final.xml`);
    const minimalXml = path.join(__dirname, 'minimal.xml');
    const proc = spawn(
      'npx',
      [
        'tsx',
        'auto_generate_xml_allinone.ts',
        '--video', videoPath,
        '--clips', clipsJsonPath,
        '--output', outputXml,
        '--template', minimalXml
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
  try {
    console.log('[STEP 1] Running splitAndAnalyzeVideoMain...');
    const mergedClipsJson = await runSplitAndAnalyze(videoPath);
    console.log('[STEP 2] Running auto_generate_xml_allinone...');
    await runAutoGenerateXML(videoPath, mergedClipsJson);
    console.log('[DONE] XML generated successfully.');
  } catch (e: any) {
    console.error('[ERROR]', e.message || e);
    process.exit(1);
  }
}

main(); 