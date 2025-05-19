import { DOMParser, XMLSerializer } from "xmldom";
import * as fs from "node:fs/promises";
import * as fsSync from "node:fs";
import * as path from "node:path";
import * as cp from "node:child_process";
import * as url from "node:url";
import xpath from "xpath";
import DecimalJs from 'decimal.js';
const Decimal = DecimalJs as any;
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import { default as xmlFormatter } from "xml-formatter";

// --- 共通ユーティリティ ---
function formatXml(
  xmlString: string,
  xmlDeclaration: string,
  doctypeDeclaration: string
): string {
  let finalXmlString = xmlString;
  if (!finalXmlString.startsWith("<?xml")) {
    finalXmlString = xmlDeclaration + "\n" + finalXmlString;
  }
  if (
    doctypeDeclaration &&
    !finalXmlString.includes(doctypeDeclaration.split(" ")[0])
  ) {
    const lines = finalXmlString.split("\n");
    let declarationIndex = lines.findIndex((line) => line.startsWith("<?xml"));
    if (declarationIndex !== -1 && declarationIndex + 1 < lines.length) {
      lines.splice(declarationIndex + 1, 0, doctypeDeclaration);
      finalXmlString = lines.join("\n");
    } else {
      finalXmlString =
        xmlDeclaration +
        "\n" +
        doctypeDeclaration +
        "\n" +
        (finalXmlString.startsWith("<?xml")
          ? finalXmlString.substring(finalXmlString.indexOf("\n") + 1)
          : finalXmlString);
    }
  }
  return finalXmlString;
}

// --- create_sequence.ts のロジック ---
const PP_TICKS_PER_SECOND = 254016000000;
interface FfprobeOutput {
  format: any;
  streams: FfprobeStream[];
}
interface FfprobeStream {
  index: number;
  codec_type: string;
  r_frame_rate: string;
  avg_frame_rate: string;
  width?: number;
  height?: number;
  sample_aspect_ratio?: string;
  field_order?: string;
  sample_rate?: string;
  channels?: number;
}
function get_video_info(videoPath: string): FfprobeOutput | null {
  const videoFile = path.resolve(videoPath);
  if (!fsSync.existsSync(videoFile) || !fsSync.statSync(videoFile).isFile()) {
    console.error(`エラー: 動画ファイルが見つかりません: ${videoPath}`);
    return null;
  }
  const cmd = "ffprobe";
  const args = [
    "-v",
    "quiet",
    "-print_format",
    "json",
    "-show_format",
    "-show_streams",
    videoFile,
  ];
  try {
    const result = cp.spawnSync(cmd, args, { encoding: "utf-8" });
    if (result.error) {
      console.error(`エラー: ffprobeの起動に失敗: ${result.error.message}`);
      return null;
    }
    if (result.status !== 0) {
      console.error(`エラー: ffprobeの実行に失敗: ${result.stderr}`);
      return null;
    }
    return JSON.parse(result.stdout) as FfprobeOutput;
  } catch (e: any) {
    console.error(`ffprobe実行中にエラー: ${e.message}`);
    return null;
  }
}
function get_rate_elements(frameRateStr: string): {
  timebase: string;
  ntsc: string;
} {
  try {
    const [numStr, denStr] = frameRateStr.split("/");
    const num = parseInt(numStr);
    const den = parseInt(denStr);
    const fps = num / den;
    if (Math.abs(fps - 23.976) < 0.01) return { timebase: "24", ntsc: "TRUE" };
    if (Math.abs(fps - 29.97) < 0.01) return { timebase: "30", ntsc: "TRUE" };
    if (Math.abs(fps - 59.94) < 0.01) return { timebase: "60", ntsc: "TRUE" };
    if (Math.abs(fps - 24) < 0.01) return { timebase: "24", ntsc: "FALSE" };
    if (Math.abs(fps - 25) < 0.01) return { timebase: "25", ntsc: "FALSE" };
    if (Math.abs(fps - 30) < 0.01) return { timebase: "30", ntsc: "FALSE" };
    if (Math.abs(fps - 50) < 0.01) return { timebase: "50", ntsc: "FALSE" };
    if (Math.abs(fps - 60) < 0.01) return { timebase: "60", ntsc: "FALSE" };
    return { timebase: "60", ntsc: "TRUE" };
  } catch {
    return { timebase: "60", ntsc: "TRUE" };
  }
}
function update_rate_element(
  rateElement: Element | null,
  timebaseStr: string,
  ntscStr: string
) {
  if (!rateElement) return;
  const timebaseElem = rateElement.getElementsByTagName("timebase")[0];
  const ntscElem = rateElement.getElementsByTagName("ntsc")[0];
  if (timebaseElem) timebaseElem.textContent = timebaseStr;
  if (ntscElem) ntscElem.textContent = ntscStr;
}
function setTextContent(
  element: Element | undefined | null,
  tagName: string,
  text: string
) {
  if (!element) return;
  const target = element.getElementsByTagName(tagName)[0];
  if (target) {
    target.textContent = text;
  } else {
    const newElem = element.ownerDocument.createElement(tagName);
    newElem.textContent = text;
    element.appendChild(newElem);
  }
}
function setOrCreateTextContent(
  doc: Document,
  parent: Element,
  tagName: string,
  text: string
): Element {
  let elem = parent.getElementsByTagName(tagName)[0];
  if (!elem) {
    elem = doc.createElement(tagName);
    parent.appendChild(elem);
  }
  elem.textContent = text;
  return elem;
}
async function create_sequence_xml(
  templateXmlPath: string,
  videoPathStr: string,
  outputXmlPath: string
): Promise<boolean> {
  let tree: Document;
  let root: Element;
  try {
    const templateXmlContent = await fs.readFile(templateXmlPath, "utf-8");
    const parser = new DOMParser();
    tree = parser.parseFromString(templateXmlContent, "application/xml");
    const parseError = tree.getElementsByTagName("parsererror");
    if (parseError.length > 0) {
      console.error(
        `エラー: テンプレートXMLファイル ${templateXmlPath} のパースに失敗: ${parseError[0].textContent}`
      );
      return false;
    }
    root = tree.documentElement;
  } catch (e: any) {
    console.error(`XMLパース中にエラー: ${e.message}`);
    return false;
  }
  const videoInfo = get_video_info(videoPathStr);
  if (!videoInfo) return false;
  const sequence = tree.getElementsByTagName("sequence")[0];
  if (!sequence) {
    console.error(
      "エラー: テンプレートXML内に <sequence> タグが見つかりません。"
    );
    return false;
  }
  const videoFile = path.resolve(videoPathStr);
  const filename = path.basename(videoFile);
  const pathurl = url.pathToFileURL(videoFile).toString();
  const formatInfo = videoInfo.format || {};
  const streams = videoInfo.streams || [];
  const videoStream = streams.find((s) => s.codec_type === "video");
  const audioStream = streams.find((s) => s.codec_type === "audio");
  if (!videoStream) {
    console.error("エラー: 動画ファイルにビデオストリームが見つかりません。");
    return false;
  }
  const durationSec = parseFloat(formatInfo.duration || "0");
  let frameRateStr = videoStream.r_frame_rate;
  if (!frameRateStr || frameRateStr === "0/0") {
    frameRateStr = videoStream.avg_frame_rate || "60000/1001";
  }
  const { timebase: timebaseStr, ntsc: ntscStr } =
    get_rate_elements(frameRateStr);
  let frameRateFloat = 60000 / 1001;
  try {
    const [num, den] = frameRateStr.split("/").map((s) => parseInt(s));
    if (den !== 0) frameRateFloat = num / den;
  } catch {}
  const durationFrames = Math.round(durationSec * frameRateFloat);
  const pproTicksOut = String(Math.round(durationSec * PP_TICKS_PER_SECOND));
  const width = videoStream.width;
  const height = videoStream.height;
  if (!width || !height) {
    console.error("エラー: 動画の幅または高さを判別できませんでした。");
    return false;
  }
  const sar = videoStream.sample_aspect_ratio || "1:1";
  const pixelAspectRatio = sar === "1:1" ? "square" : sar;
  const fieldOrder = videoStream.field_order || "progressive";
  const fieldDominance = fieldOrder === "progressive" ? "none" : fieldOrder;
  const audioSampleRate = audioStream
    ? parseInt(audioStream.sample_rate || "48000")
    : 48000;
  const audioDepth = 16;
  const audioChannels = audioStream ? audioStream.channels || 0 : 0;
  // 1. シーケンスレベルの更新
  setTextContent(sequence, "name", path.parse(filename).name);
  setTextContent(sequence, "duration", String(durationFrames));
  update_rate_element(
    sequence.getElementsByTagName("rate")[0],
    timebaseStr,
    ntscStr
  );
  const timecodeElem = sequence.getElementsByTagName("timecode")[0];
  if (timecodeElem) {
    update_rate_element(
      timecodeElem.getElementsByTagName("rate")[0],
      timebaseStr,
      ntscStr
    );
    setTextContent(
      timecodeElem,
      "displayformat",
      ntscStr === "TRUE" ? "DF" : "NDF"
    );
  }
  sequence.setAttribute("MZ.Sequence.PreviewFrameSizeWidth", String(width));
  sequence.setAttribute("MZ.Sequence.PreviewFrameSizeHeight", String(height));
  // 2. メディア設定の更新
  const media = sequence.getElementsByTagName("media")[0];
  const videoMedia = media?.getElementsByTagName("video")[0];
  const audioMedia = media?.getElementsByTagName("audio")[0];
  if (videoMedia) {
    const videoFormatSc = videoMedia
      .getElementsByTagName("format")[0]
      ?.getElementsByTagName("samplecharacteristics")[0];
    if (videoFormatSc) {
      update_rate_element(
        videoFormatSc.getElementsByTagName("rate")[0],
        timebaseStr,
        ntscStr
      );
      setTextContent(videoFormatSc, "width", String(width));
      setTextContent(videoFormatSc, "height", String(height));
      setTextContent(videoFormatSc, "pixelaspectratio", pixelAspectRatio);
      setTextContent(videoFormatSc, "fielddominance", fieldDominance);
    }
  }
  if (audioMedia) {
    const audioFormatSc = audioMedia
      .getElementsByTagName("format")[0]
      ?.getElementsByTagName("samplecharacteristics")[0];
    if (audioFormatSc) {
      setTextContent(audioFormatSc, "depth", String(audioDepth));
      setTextContent(audioFormatSc, "samplerate", String(audioSampleRate));
    }
  }
  // 3. ファイル定義
  const fileElement = tree.createElement("file");
  fileElement.setAttribute("id", "file-1");
  setOrCreateTextContent(tree, fileElement, "name", filename);
  setOrCreateTextContent(tree, fileElement, "pathurl", pathurl);
  const fileRate = setOrCreateTextContent(tree, fileElement, "rate", "");
  setOrCreateTextContent(tree, fileRate, "timebase", timebaseStr);
  setOrCreateTextContent(tree, fileRate, "ntsc", ntscStr);
  setOrCreateTextContent(tree, fileElement, "duration", String(durationFrames));
  const startFrame = 0;
  const startTcStr = formatInfo.tags?.timecode || "00:00:00:00";
  const fileTimecode = setOrCreateTextContent(
    tree,
    fileElement,
    "timecode",
    ""
  );
  const fileTcRate = setOrCreateTextContent(tree, fileTimecode, "rate", "");
  setOrCreateTextContent(tree, fileTcRate, "timebase", timebaseStr);
  setOrCreateTextContent(tree, fileTcRate, "ntsc", ntscStr);
  setOrCreateTextContent(
    tree,
    fileTimecode,
    "string",
    ntscStr === "TRUE" ? startTcStr.replace(/:/g, ";") : startTcStr
  );
  setOrCreateTextContent(tree, fileTimecode, "frame", String(startFrame));
  setOrCreateTextContent(
    tree,
    fileTimecode,
    "displayformat",
    ntscStr === "TRUE" ? "DF" : "NDF"
  );
  const fileMedia = setOrCreateTextContent(tree, fileElement, "media", "");
  const fmVideo = setOrCreateTextContent(tree, fileMedia, "video", "");
  const fmVideoSc = setOrCreateTextContent(
    tree,
    fmVideo,
    "samplecharacteristics",
    ""
  );
  const fmVideoScRate = setOrCreateTextContent(tree, fmVideoSc, "rate", "");
  setOrCreateTextContent(tree, fmVideoScRate, "timebase", timebaseStr);
  setOrCreateTextContent(tree, fmVideoScRate, "ntsc", ntscStr);
  setOrCreateTextContent(tree, fmVideoSc, "width", String(width));
  setOrCreateTextContent(tree, fmVideoSc, "height", String(height));
  setOrCreateTextContent(tree, fmVideoSc, "anamorphic", "FALSE");
  setOrCreateTextContent(tree, fmVideoSc, "pixelaspectratio", pixelAspectRatio);
  setOrCreateTextContent(tree, fmVideoSc, "fielddominance", fieldDominance);
  if (audioStream && audioChannels > 0) {
    const fmAudio = setOrCreateTextContent(tree, fileMedia, "audio", "");
    const fmAudioSc = setOrCreateTextContent(
      tree,
      fmAudio,
      "samplecharacteristics",
      ""
    );
    setOrCreateTextContent(tree, fmAudioSc, "depth", String(audioDepth));
    setOrCreateTextContent(
      tree,
      fmAudioSc,
      "samplerate",
      String(audioSampleRate)
    );
  }
  // 4. クリップアイテムの生成と挿入
  const videoTrack = videoMedia?.getElementsByTagName("track")[0];
  const audioTracks = audioMedia
    ? Array.from(audioMedia.getElementsByTagName("track"))
    : [];
  if (videoTrack) {
    Array.from(videoTrack.getElementsByTagName("clipitem")).forEach((item) =>
      videoTrack.removeChild(item)
    );
  }
  audioTracks.forEach((track) => {
    Array.from(track.getElementsByTagName("clipitem")).forEach((item) =>
      track.removeChild(item)
    );
  });
  const masterclipId = "masterclip-1";
  if (videoTrack) {
    const clipitemVideo = tree.createElement("clipitem");
    clipitemVideo.setAttribute("id", "clipitem-1");
    setOrCreateTextContent(tree, clipitemVideo, "masterclipid", masterclipId);
    setOrCreateTextContent(tree, clipitemVideo, "name", filename);
    setOrCreateTextContent(tree, clipitemVideo, "enabled", "TRUE");
    setOrCreateTextContent(
      tree,
      clipitemVideo,
      "duration",
      String(durationFrames)
    );
    const clipRate = setOrCreateTextContent(tree, clipitemVideo, "rate", "");
    setOrCreateTextContent(tree, clipRate, "timebase", timebaseStr);
    setOrCreateTextContent(tree, clipRate, "ntsc", ntscStr);
    setOrCreateTextContent(tree, clipitemVideo, "start", "0");
    setOrCreateTextContent(tree, clipitemVideo, "end", String(durationFrames));
    setOrCreateTextContent(tree, clipitemVideo, "in", String(startFrame));
    setOrCreateTextContent(
      tree,
      clipitemVideo,
      "out",
      String(startFrame + durationFrames)
    );
    setOrCreateTextContent(tree, clipitemVideo, "pproTicksIn", "0");
    setOrCreateTextContent(tree, clipitemVideo, "pproTicksOut", pproTicksOut);
    setOrCreateTextContent(tree, clipitemVideo, "alphatype", "none");
    setOrCreateTextContent(
      tree,
      clipitemVideo,
      "pixelaspectratio",
      pixelAspectRatio
    );
    setOrCreateTextContent(tree, clipitemVideo, "anamorphic", "FALSE");
    clipitemVideo.appendChild(fileElement.cloneNode(true) as Element);
    const linkVV = setOrCreateTextContent(tree, clipitemVideo, "link", "");
    setOrCreateTextContent(tree, linkVV, "linkclipref", "clipitem-1");
    setOrCreateTextContent(tree, linkVV, "mediatype", "video");
    setOrCreateTextContent(tree, linkVV, "trackindex", "1");
    setOrCreateTextContent(tree, linkVV, "clipindex", "1");
    if (audioStream && audioChannels > 0) {
      const numAudioLinks = Math.min(audioChannels, 2);
      for (let i = 0; i < numAudioLinks; i++) {
        const linkVA = tree.createElement("link");
        clipitemVideo.appendChild(linkVA);
        setOrCreateTextContent(
          tree,
          linkVA,
          "linkclipref",
          `clipitem-${i + 2}`
        );
        setOrCreateTextContent(tree, linkVA, "mediatype", "audio");
        setOrCreateTextContent(tree, linkVA, "trackindex", String(i + 1));
        setOrCreateTextContent(tree, linkVA, "clipindex", "1");
        setOrCreateTextContent(tree, linkVA, "groupindex", "1");
      }
    }
    setOrCreateTextContent(tree, clipitemVideo, "logginginfo", "");
    setOrCreateTextContent(tree, clipitemVideo, "colorinfo", "");
    const labels = setOrCreateTextContent(tree, clipitemVideo, "labels", "");
    setOrCreateTextContent(tree, labels, "label2", "Iris");
    const enabledElem = videoTrack.getElementsByTagName("enabled")[0];
    if (enabledElem && enabledElem.parentNode === videoTrack) {
      videoTrack.insertBefore(clipitemVideo, enabledElem);
    } else {
      videoTrack.appendChild(clipitemVideo);
    }
  }
  if (audioStream && audioChannels > 0) {
    const numAudioClipsToCreate = Math.min(
      audioChannels,
      audioTracks.length,
      2
    );
    for (let i = 0; i < numAudioClipsToCreate; i++) {
      const clipId = `clipitem-${i + 2}`;
      const trackIndex = i + 1;
      const audioTrack = audioTracks[i];
      audioTrack.setAttribute("currentExplodedTrackIndex", String(i));
      audioTrack.setAttribute(
        "totalExplodedTrackCount",
        String(numAudioClipsToCreate)
      );
      audioTrack.setAttribute(
        "premiereTrackType",
        audioChannels >= 2 ? "Stereo" : "Mono"
      );
      const clipitemAudio = tree.createElement("clipitem");
      clipitemAudio.setAttribute("id", clipId);
      clipitemAudio.setAttribute(
        "premiereChannelType",
        audioChannels >= 2 ? "stereo" : "mono"
      );
      setOrCreateTextContent(tree, clipitemAudio, "masterclipid", masterclipId);
      setOrCreateTextContent(tree, clipitemAudio, "name", filename);
      setOrCreateTextContent(tree, clipitemAudio, "enabled", "TRUE");
      setOrCreateTextContent(
        tree,
        clipitemAudio,
        "duration",
        String(durationFrames)
      );
      const clipRateAudio = setOrCreateTextContent(
        tree,
        clipitemAudio,
        "rate",
        ""
      );
      setOrCreateTextContent(tree, clipRateAudio, "timebase", timebaseStr);
      setOrCreateTextContent(tree, clipRateAudio, "ntsc", ntscStr);
      setOrCreateTextContent(tree, clipitemAudio, "start", "0");
      setOrCreateTextContent(
        tree,
        clipitemAudio,
        "end",
        String(durationFrames)
      );
      setOrCreateTextContent(tree, clipitemAudio, "in", String(startFrame));
      setOrCreateTextContent(
        tree,
        clipitemAudio,
        "out",
        String(startFrame + durationFrames)
      );
      setOrCreateTextContent(tree, clipitemAudio, "pproTicksIn", "0");
      setOrCreateTextContent(tree, clipitemAudio, "pproTicksOut", pproTicksOut);
      const fileRefAudio = tree.createElement("file");
      fileRefAudio.setAttribute("id", "file-1");
      clipitemAudio.appendChild(fileRefAudio);
      const sourcetrack = setOrCreateTextContent(
        tree,
        clipitemAudio,
        "sourcetrack",
        ""
      );
      setOrCreateTextContent(tree, sourcetrack, "mediatype", "audio");
      setOrCreateTextContent(
        tree,
        sourcetrack,
        "trackindex",
        String(trackIndex)
      );
      const linkAV = tree.createElement("link");
      clipitemAudio.appendChild(linkAV);
      setOrCreateTextContent(tree, linkAV, "linkclipref", "clipitem-1");
      setOrCreateTextContent(tree, linkAV, "mediatype", "video");
      setOrCreateTextContent(tree, linkAV, "trackindex", "1");
      setOrCreateTextContent(tree, linkAV, "clipindex", "1");
      for (let j = 0; j < numAudioClipsToCreate; j++) {
        const linkAA = tree.createElement("link");
        clipitemAudio.appendChild(linkAA);
        setOrCreateTextContent(
          tree,
          linkAA,
          "linkclipref",
          `clipitem-${j + 2}`
        );
        setOrCreateTextContent(tree, linkAA, "mediatype", "audio");
        setOrCreateTextContent(tree, linkAA, "trackindex", String(j + 1));
        setOrCreateTextContent(tree, linkAA, "clipindex", "1");
        setOrCreateTextContent(tree, linkAA, "groupindex", "1");
      }
      setOrCreateTextContent(tree, clipitemAudio, "logginginfo", "");
      setOrCreateTextContent(tree, clipitemAudio, "colorinfo", "");
      const labelsA = setOrCreateTextContent(tree, clipitemAudio, "labels", "");
      setOrCreateTextContent(tree, labelsA, "label2", "Iris");
      const enabledElemA = audioTrack.getElementsByTagName("enabled")[0];
      if (enabledElemA && enabledElemA.parentNode === audioTrack) {
        audioTrack.insertBefore(clipitemAudio, enabledElemA);
      } else {
        audioTrack.appendChild(clipitemAudio);
      }
    }
  }
  try {
    const serializer = new XMLSerializer();
    let xmlContent = serializer.serializeToString(root);
    const xmlDeclaration = '<?xml version="1.0" encoding="UTF-8"?>';
    const doctypeDeclaration = "<!DOCTYPE xmeml []>";
    const finalXmlString = formatXml(
      xmlContent,
      xmlDeclaration,
      doctypeDeclaration
    );
    await fs.writeFile(outputXmlPath, finalXmlString, "utf-8");
    return true;
  } catch (e: any) {
    console.error(
      `エラー: 出力XMLファイル ${outputXmlPath} の書き込み/整形に失敗: ${e.message}`
    );
    return false;
  }
}

// --- edit_premiere_xml.ts のロジック ---
const PPRO_TICKS_PER_SECOND_DEC = new Decimal("254016000000");
Decimal.set({ precision: 100, rounding: Decimal.ROUND_HALF_UP });
interface ClipInfo {
  start_time: string | number;
  end_time: string | number;
  name?: string;
  importance?: number;
}
interface ClipConfig {
  clips: ClipInfo[];
}
function timecodeToFrames(
  tcStr: string,
  timebase: number,
  ntsc: boolean
): number {
  const parts = tcStr.replace(/;/g, ":").split(":");
  if (parts.length !== 4)
    throw new Error(`無効なタイムコード形式です: ${tcStr}`);
  const [h, m, s, f] = parts.map((p) => parseInt(p));
  const frameRateDecimal = new Decimal(timebase);
  const totalSeconds = new Decimal(h * 3600 + m * 60 + s).plus(
    new Decimal(f).div(frameRateDecimal)
  );
  return totalSeconds
    .mul(frameRateDecimal)
    .toDecimalPlaces(0, Decimal.ROUND_HALF_UP)
    .toNumber();
}
function secondsToFrames(seconds: number | string, timebase: number): number {
  const frameRateDecimal = new Decimal(timebase);
  return new Decimal(seconds)
    .mul(frameRateDecimal)
    .toDecimalPlaces(0, Decimal.ROUND_HALF_UP)
    .toNumber();
}
function framesToPproTicks(frames: number, timebase: number): string {
  if (timebase === 0) return "0";
  const ticks = new Decimal(frames)
    .mul(PPRO_TICKS_PER_SECOND_DEC)
    .div(new Decimal(timebase));
  return ticks.toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toString();
}
function parseTime(
  timeStr: string | number,
  timebase: number,
  ntsc: boolean
): number {
  if (typeof timeStr === "number") return secondsToFrames(Math.floor(timeStr), timebase);
  if (typeof timeStr === "string") {
    // MM:SS形式対応
    if (/^\d{1,2}:\d{2}$/.test(timeStr)) {
      const [m, s] = timeStr.split(":").map(v => Math.floor(Number(v)));
      return secondsToFrames(m * 60 + s, timebase);
    }
    // HH:MM:SS形式対応（ミリ秒や小数点以下は無視）
    if (/^\d{1,2}:\d{2}:\d{2}/.test(timeStr)) {
      const [h, m, s] = timeStr.split(":").map(v => Math.floor(Number(v)));
      return secondsToFrames(h * 3600 + m * 60 + s, timebase);
    }
    // タイムコード形式 or 秒数
    if (timeStr.includes(":") || timeStr.includes(";"))
      return timecodeToFrames(timeStr, timebase, ntsc);
    return secondsToFrames(Math.floor(parseFloat(timeStr)), timebase);
  }
  throw new Error(`無効な時間型: ${typeof timeStr}`);
}
function findOrCreateTrack(
  doc: Document,
  mediaElement: Element,
  trackType: "video" | "audio",
  trackIndex: number
): Element {
  let tracks = Array.from(
    mediaElement.getElementsByTagName("track")
  ) as Element[];
  if (trackIndex <= tracks.length) return tracks[trackIndex - 1] as Element;
  for (let i = tracks.length; i < trackIndex; i++) {
    const newTrack = doc.createElement("track");
    const enabled = doc.createElement("enabled");
    enabled.textContent = "TRUE";
    newTrack.appendChild(enabled);
    const locked = doc.createElement("locked");
    locked.textContent = "FALSE";
    newTrack.appendChild(locked);
    if (trackType === "audio") {
      const outIdx = doc.createElement("outputchannelindex");
      outIdx.textContent = String((i % 2) + 1);
      newTrack.appendChild(outIdx);
      newTrack.setAttribute("premiereTrackType", "Stereo");
      newTrack.setAttribute("PannerCurrentValue", "0.5");
      newTrack.setAttribute("PannerName", "Balance");
      const defaultPannerStartKeyframe = "-91445760000000000,0.5,0,0,0,0,0,0";
      newTrack.setAttribute("PannerStartKeyframe", defaultPannerStartKeyframe);
      newTrack.setAttribute("TL.SQTrackAudioKeyframeStyle", "0");
    }
    mediaElement.appendChild(newTrack);
  }
  tracks = Array.from(mediaElement.getElementsByTagName("track"));
  if (trackIndex <= tracks.length) return tracks[trackIndex - 1];
  throw new Error(`Track creation failed for index ${trackIndex}`);
}
function createTextElement(
  doc: Document,
  name: string,
  text: string = ""
): Element {
  const el = doc.createElement(name);
  el.textContent = text;
  return el;
}
function createLoggingInfo(doc: Document): Element {
  const logInfo = doc.createElement("logginginfo");
  logInfo.appendChild(createTextElement(doc, "description"));
  logInfo.appendChild(createTextElement(doc, "scene"));
  logInfo.appendChild(createTextElement(doc, "shottake"));
  logInfo.appendChild(createTextElement(doc, "lognote"));
  logInfo.appendChild(createTextElement(doc, "good"));
  logInfo.appendChild(createTextElement(doc, "originalvideofilename"));
  logInfo.appendChild(createTextElement(doc, "originalaudiofilename"));
  return logInfo;
}
function createColorInfo(doc: Document): Element {
  const colorInfo = doc.createElement("colorinfo");
  colorInfo.appendChild(createTextElement(doc, "lut"));
  colorInfo.appendChild(createTextElement(doc, "lut1"));
  colorInfo.appendChild(createTextElement(doc, "asc_sop"));
  colorInfo.appendChild(createTextElement(doc, "asc_sat"));
  colorInfo.appendChild(createTextElement(doc, "lut2"));
  return colorInfo;
}
function createClipLabels(doc: Document): Element {
  const labels = doc.createElement("labels");
  labels.appendChild(createTextElement(doc, "label2", "Iris"));
  return labels;
}
function createAudioLevelsFilter(doc: Document): Element {
  const filterEl = doc.createElement("filter");
  const effectEl = doc.createElement("effect");
  filterEl.appendChild(effectEl);
  effectEl.appendChild(createTextElement(doc, "name", "Audio Levels"));
  effectEl.appendChild(createTextElement(doc, "effectid", "audiolevels"));
  effectEl.appendChild(createTextElement(doc, "effectcategory", "audiolevels"));
  effectEl.appendChild(createTextElement(doc, "effecttype", "audiolevels"));
  effectEl.appendChild(createTextElement(doc, "mediatype", "audio"));
  effectEl.appendChild(createTextElement(doc, "pproBypass", "false"));
  const paramEl = doc.createElement("parameter");
  paramEl.setAttribute("authoringApp", "PremierePro");
  effectEl.appendChild(paramEl);
  paramEl.appendChild(createTextElement(doc, "parameterid", "level"));
  paramEl.appendChild(createTextElement(doc, "name", "Level"));
  paramEl.appendChild(createTextElement(doc, "value", "1"));
  return filterEl;
}
async function processXml(
  jsonPath: string,
  sourceXmlPath: string,
  outputXmlPath: string
): Promise<void> {
  let config: ClipConfig;
  try {
    const jsonContent = await fs.readFile(jsonPath, "utf-8");
    config = JSON.parse(jsonContent) as ClipConfig;
    if (!config.clips) {
      console.error(`エラー: ${jsonPath} に 'clips' 配列が見つかりません。`);
      return;
    }
  } catch (e: any) {
    console.error(`エラー: JSONファイルの読み込み (${jsonPath}): ${e.message}`);
    return;
  }
  let doc: Document;
  let root: Element;
  try {
    const xmlContent = await fs.readFile(sourceXmlPath, "utf-8");
    doc = new DOMParser().parseFromString(xmlContent, "application/xml");
    const parseError = doc.getElementsByTagName("parsererror");
    if (parseError.length > 0) {
      console.error(
        `エラー: XMLのパース (${sourceXmlPath}): ${parseError[0].textContent}`
      );
      return;
    }
    root = doc.documentElement;
  } catch (e: any) {
    console.error(`エラー: XMLのパース (${sourceXmlPath}): ${e.message}`);
    return;
  }
  const sequence = xpath.select1(".//*[local-name()='sequence']", root) as
    | Element
    | undefined;
  if (!sequence) {
    console.error("エラー: <sequence> 要素が見つかりません。");
    return;
  }
  if (!sequence.getAttribute("MZ.ZeroPoint")) {
    sequence.setAttribute("MZ.ZeroPoint", "0");
  }
  const rateEl = xpath.select1("./*[local-name()='rate']", sequence) as
    | Element
    | undefined;
  if (!rateEl) {
    console.error("エラー: sequence内に<rate>が見つかりません。");
    return;
  }
  const timebaseEl = xpath.select1("./*[local-name()='timebase']", rateEl) as
    | Element
    | undefined;
  const ntscEl = xpath.select1("./*[local-name()='ntsc']", rateEl) as
    | Element
    | undefined;
  if (!timebaseEl || !ntscEl) {
    console.error("エラー: rate内に<timebase>または<ntsc>が見つかりません。");
    return;
  }
  const timebase = parseInt(timebaseEl.textContent || "0");
  const ntsc = (ntscEl.textContent || "FALSE").toUpperCase() === "TRUE";
  const media = xpath.select1("./*[local-name()='media']", sequence) as
    | Element
    | undefined;
  if (!media) {
    console.error("エラー: sequence内に<media>が見つかりません。");
    return;
  }
  const videoMedia = xpath.select1("./*[local-name()='video']", media) as
    | Element
    | undefined;
  const audioMedia = xpath.select1("./*[local-name()='audio']", media) as
    | Element
    | undefined;
  if (!videoMedia || !audioMedia) {
    console.error(
      "エラー: <media>内に <video> または <audio> が見つかりません。"
    );
    return;
  }
  let fileRefId: string | null = null;
  let masterClipId: string | null = null;
  let masterClipDuration: string | null = null;
  let pixelAspectRatio = "square";
  let anamorphic = "FALSE";
  let alphatype = "none";
  let completeFileElement: Element | null = null;
  const firstFileWithIdNode = xpath.select1(
    ".//*[local-name()='file'][@id]",
    sequence
  ) as Element | undefined;
  if (firstFileWithIdNode) {
    completeFileElement = firstFileWithIdNode.cloneNode(true) as Element;
    fileRefId = completeFileElement.getAttribute("id");
    const durationEl = xpath.select1(
      ".//*[local-name()='duration']",
      completeFileElement
    ) as Element | undefined;
    if (durationEl) masterClipDuration = durationEl.textContent;
    const paEl = xpath.select1(
      ".//*[local-name()='media']/*[local-name()='video']/*[local-name()='samplecharacteristics']/*[local-name()='pixelaspectratio']",
      completeFileElement
    ) as Element | undefined;
    if (paEl) pixelAspectRatio = paEl.textContent || "square";
    const anEl = xpath.select1(
      ".//*[local-name()='media']/*[local-name()='video']/*[local-name()='samplecharacteristics']/*[local-name()='anamorphic']",
      completeFileElement
    ) as Element | undefined;
    if (anEl) anamorphic = anEl.textContent || "FALSE";
    const firstClipitemWithFile = xpath.select1(
      `.//*[local-name()='clipitem'][.//*[local-name()='file'][@id='${fileRefId}']]`,
      sequence
    ) as Element | undefined;
    if (firstClipitemWithFile) {
      const alphaEl = xpath.select1(
        "./*[local-name()='alphatype']",
        firstClipitemWithFile
      ) as Element | undefined;
      if (alphaEl) alphatype = alphaEl.textContent || "none";
    }
  } else {
    console.error("エラー: ID付きの <file> 要素が見つかりません。");
    return;
  }
  const firstMasterClipIdNode = xpath.select1(
    ".//*[local-name()='masterclipid']",
    sequence
  ) as Element | undefined;
  if (firstMasterClipIdNode) {
    masterClipId = firstMasterClipIdNode.textContent;
  } else {
    masterClipId = "masterclip-placeholder";
  }
  if (!masterClipDuration) {
    console.error("エラー: マスタークリップのデュレーションを特定できません。");
    return;
  }
  if (!completeFileElement) {
    console.error("エラー: 完全な <file> 要素の構造を取得できませんでした。");
    return;
  }
  const tracksToRemoveClipsFrom = xpath.select(
    ".//*[local-name()='track']",
    media
  ) as Element[];
  tracksToRemoveClipsFrom.forEach((track) => {
    const itemsToRemove = xpath.select(
      "./*[local-name()='clipitem']",
      track
    ) as Element[];
    itemsToRemove.forEach((item) => track.removeChild(item));
  });
  const clipIndexCounters: { [key: number]: number } = { 1: 0, 2: 0, 3: 0 };
  const audioClipIndexCounters: { [key: number]: number } = { 1: 0, 2: 0 };
  let clipitemGlobalIdCounter = 1;
  let isFirstV1Clip = true;
  for (let i = 0; i < config.clips.length; i++) {
    const clipInfo = config.clips[i];
    const startTimeVal = clipInfo.start_time;
    const endTimeVal = clipInfo.end_time;
    const clipName = clipInfo.name || `Clip_${i + 1}`;
    let importance = clipInfo.importance || 1;
    if (startTimeVal === undefined || endTimeVal === undefined) continue;
    if (![1, 2, 3].includes(importance)) importance = 1;
    let startFrame: number, endFrame: number;
    try {
      startFrame = parseTime(startTimeVal, timebase, ntsc);
      endFrame = parseTime(endTimeVal, timebase, ntsc);
    } catch (e: any) {
      continue;
    }
    if (endFrame <= startFrame) continue;
    const startTicks = framesToPproTicks(startFrame, timebase);
    const endTicks = framesToPproTicks(endFrame, timebase);
    const vClipId = `clipitem-${clipitemGlobalIdCounter++}`;
    const a1ClipId = `clipitem-${clipitemGlobalIdCounter++}`;
    const a2ClipId = `clipitem-${clipitemGlobalIdCounter++}`;
    const videoTrackIndex = importance;
    clipIndexCounters[videoTrackIndex]++;
    const vClipSequenceIndex = clipIndexCounters[videoTrackIndex];
    const targetVideoTrack = findOrCreateTrack(
      doc,
      videoMedia,
      "video",
      videoTrackIndex
    );
    const vClip = doc.createElement("clipitem");
    vClip.setAttribute("id", vClipId);
    vClip.appendChild(createTextElement(doc, "masterclipid", masterClipId!));
    vClip.appendChild(createTextElement(doc, "name", clipName));
    vClip.appendChild(createTextElement(doc, "enabled", "TRUE"));
    vClip.appendChild(createTextElement(doc, "duration", masterClipDuration!));
    const vRate = doc.createElement("rate");
    vRate.appendChild(createTextElement(doc, "timebase", String(timebase)));
    vRate.appendChild(createTextElement(doc, "ntsc", ntsc ? "TRUE" : "FALSE"));
    vClip.appendChild(vRate);
    vClip.appendChild(createTextElement(doc, "start", String(startFrame)));
    vClip.appendChild(createTextElement(doc, "end", String(endFrame)));
    vClip.appendChild(createTextElement(doc, "in", String(startFrame)));
    vClip.appendChild(createTextElement(doc, "out", String(endFrame)));
    vClip.appendChild(createTextElement(doc, "pproTicksIn", startTicks));
    vClip.appendChild(createTextElement(doc, "pproTicksOut", endTicks));
    if (videoTrackIndex === 1 && isFirstV1Clip) {
      vClip.appendChild(completeFileElement!.cloneNode(true) as Element);
      isFirstV1Clip = false;
    } else {
      const fileRef = doc.createElement("file");
      fileRef.setAttribute("id", fileRefId!);
      vClip.appendChild(fileRef);
    }
    vClip.appendChild(createTextElement(doc, "alphatype", alphatype));
    vClip.appendChild(
      createTextElement(doc, "pixelaspectratio", pixelAspectRatio)
    );
    vClip.appendChild(createTextElement(doc, "anamorphic", anamorphic));
    audioClipIndexCounters[1]++;
    const a1ClipSequenceIndex = audioClipIndexCounters[1];
    audioClipIndexCounters[2]++;
    const a2ClipSequenceIndex = audioClipIndexCounters[2];
    const linkV_V = doc.createElement("link");
    linkV_V.appendChild(createTextElement(doc, "linkclipref", vClipId));
    linkV_V.appendChild(createTextElement(doc, "mediatype", "video"));
    linkV_V.appendChild(
      createTextElement(doc, "trackindex", String(videoTrackIndex))
    );
    linkV_V.appendChild(
      createTextElement(doc, "clipindex", String(vClipSequenceIndex))
    );
    vClip.appendChild(linkV_V);
    const linkV_A1 = doc.createElement("link");
    linkV_A1.appendChild(createTextElement(doc, "linkclipref", a1ClipId));
    linkV_A1.appendChild(createTextElement(doc, "mediatype", "audio"));
    linkV_A1.appendChild(createTextElement(doc, "trackindex", "1"));
    linkV_A1.appendChild(
      createTextElement(doc, "clipindex", String(a1ClipSequenceIndex))
    );
    linkV_A1.appendChild(createTextElement(doc, "groupindex", "1"));
    vClip.appendChild(linkV_A1);
    const linkV_A2 = doc.createElement("link");
    linkV_A2.appendChild(createTextElement(doc, "linkclipref", a2ClipId));
    linkV_A2.appendChild(createTextElement(doc, "mediatype", "audio"));
    linkV_A2.appendChild(createTextElement(doc, "trackindex", "2"));
    linkV_A2.appendChild(
      createTextElement(doc, "clipindex", String(a2ClipSequenceIndex))
    );
    linkV_A2.appendChild(createTextElement(doc, "groupindex", "1"));
    vClip.appendChild(linkV_A2);
    vClip.appendChild(createLoggingInfo(doc));
    vClip.appendChild(createColorInfo(doc));
    vClip.appendChild(createClipLabels(doc));
    targetVideoTrack.appendChild(vClip);
    const audioTargetTrackIndices = [1, 2];
    const audioClipIds = [a1ClipId, a2ClipId];
    const audioSequenceIndices = [a1ClipSequenceIndex, a2ClipSequenceIndex];
    const isLastClip = i === config.clips.length - 1;
    for (let audIdx = 0; audIdx < audioTargetTrackIndices.length; audIdx++) {
      const audioTrackIdx = audioTargetTrackIndices[audIdx];
      const audioClipId = audioClipIds[audIdx];
      const aClipSequenceIndex = audioSequenceIndices[audIdx];
      const targetAudioTrack = findOrCreateTrack(
        doc,
        audioMedia,
        "audio",
        audioTrackIdx
      );
      const aClip = doc.createElement("clipitem");
      aClip.setAttribute("id", audioClipId);
      aClip.setAttribute("premiereChannelType", "stereo");
      aClip.appendChild(createTextElement(doc, "masterclipid", masterClipId!));
      aClip.appendChild(createTextElement(doc, "name", clipName));
      aClip.appendChild(createTextElement(doc, "enabled", "TRUE"));
      aClip.appendChild(
        createTextElement(doc, "duration", masterClipDuration!)
      );
      const aRate = doc.createElement("rate");
      aRate.appendChild(createTextElement(doc, "timebase", String(timebase)));
      aRate.appendChild(
        createTextElement(doc, "ntsc", ntsc ? "TRUE" : "FALSE")
      );
      aClip.appendChild(aRate);
      aClip.appendChild(createTextElement(doc, "start", String(startFrame)));
      aClip.appendChild(createTextElement(doc, "end", String(endFrame)));
      aClip.appendChild(createTextElement(doc, "in", String(startFrame)));
      const audioOutFrame = isLastClip
        ? endFrame
        : endFrame > startFrame
        ? endFrame - 1
        : endFrame;
      aClip.appendChild(createTextElement(doc, "out", String(audioOutFrame)));
      aClip.appendChild(createTextElement(doc, "pproTicksIn", startTicks));
      aClip.appendChild(createTextElement(doc, "pproTicksOut", endTicks));
      const audioFileRef = doc.createElement("file");
      audioFileRef.setAttribute("id", fileRefId!);
      aClip.appendChild(audioFileRef);
      const sourcetrack = doc.createElement("sourcetrack");
      sourcetrack.appendChild(createTextElement(doc, "mediatype", "audio"));
      sourcetrack.appendChild(
        createTextElement(doc, "trackindex", String(audioTrackIdx))
      );
      aClip.appendChild(sourcetrack);
      aClip.appendChild(createAudioLevelsFilter(doc));
      const linkA_V = doc.createElement("link");
      linkA_V.appendChild(createTextElement(doc, "linkclipref", vClipId));
      linkA_V.appendChild(createTextElement(doc, "mediatype", "video"));
      linkA_V.appendChild(
        createTextElement(doc, "trackindex", String(videoTrackIndex))
      );
      linkA_V.appendChild(
        createTextElement(doc, "clipindex", String(vClipSequenceIndex))
      );
      aClip.appendChild(linkA_V);
      const linkA_A1 = doc.createElement("link");
      linkA_A1.appendChild(createTextElement(doc, "linkclipref", a1ClipId));
      linkA_A1.appendChild(createTextElement(doc, "mediatype", "audio"));
      linkA_A1.appendChild(createTextElement(doc, "trackindex", "1"));
      linkA_A1.appendChild(
        createTextElement(doc, "clipindex", String(a1ClipSequenceIndex))
      );
      linkA_A1.appendChild(createTextElement(doc, "groupindex", "1"));
      aClip.appendChild(linkA_A1);
      const linkA_A2 = doc.createElement("link");
      linkA_A2.appendChild(createTextElement(doc, "linkclipref", a2ClipId));
      linkA_A2.appendChild(createTextElement(doc, "mediatype", "audio"));
      linkA_A2.appendChild(createTextElement(doc, "trackindex", "2"));
      linkA_A2.appendChild(
        createTextElement(doc, "clipindex", String(a2ClipSequenceIndex))
      );
      linkA_A2.appendChild(createTextElement(doc, "groupindex", "1"));
      aClip.appendChild(linkA_A2);
      aClip.appendChild(createLoggingInfo(doc));
      aClip.appendChild(createColorInfo(doc));
      aClip.appendChild(createClipLabels(doc));
      targetAudioTrack.appendChild(aClip);
    }
  }
  try {
    const serializer = new XMLSerializer();
    let xmlString = serializer.serializeToString(root);
    try {
      if (typeof (xmlFormatter as any).default === 'function') {
        xmlString = (xmlFormatter as any).default(xmlString, {
          indentation: "  ",
          collapseContent: true,
          lineSeparator: "\n",
        });
      } else {
        xmlString = (xmlFormatter as any)(xmlString, {
          indentation: "  ",
          collapseContent: true,
          lineSeparator: "\n",
        });
      }
    } catch {}
    const xmlDeclaration = '<?xml version="1.0" encoding="UTF-8"?>';
    const doctypeDeclaration = "<!DOCTYPE xmeml>";
    const finalXmlString = formatXml(
      xmlString,
      xmlDeclaration,
      doctypeDeclaration
    );
    await fs.writeFile(outputXmlPath, finalXmlString, "utf-8");
  } catch (e: any) {
    console.error(`出力XMLファイルの書き込みエラー: ${e.message}`);
  }
}

// --- メイン処理 ---
async function main() {
  const argv = await yargs(hideBin(process.argv))
    .option("video", {
      type: "string",
      describe: "入力動画ファイルのパス (例: example_video.mp4)",
      demandOption: true,
    })
    .option("clips", {
      type: "string",
      describe: "クリップ定義JSONファイルのパス (例: example_clips.json)",
      demandOption: true,
    })
    .option("output", {
      type: "string",
      describe: "出力XMLファイルのパス (省略時は <動画ファイル名>_final.xml)",
    })
    .option("keep-intermediate", {
      type: "boolean",
      default: false,
      describe: "中間XMLファイル（_sequence.xml）を削除せず残す",
    })
    .option("template", {
      type: "string",
      describe: "テンプレートXMLファイルのパス (省略時は examples/minimal.xml)",
    })
    .option("workdir", {
      type: "string",
      describe: "作業用ディレクトリ（runAllから渡される）",
    })
    .help()
    .alias("help", "h")
    .parseAsync();

  const videoP = path.resolve(argv.video);
  const clipsJsonP = path.resolve(argv.clips);
  const workDir = argv.workdir ? path.resolve(argv.workdir) : path.dirname(videoP);
  const templateXml = path.resolve(
    argv.template || path.join("examples", "minimal.xml")
  );
  if (!fsSync.existsSync(videoP) || !fsSync.statSync(videoP).isFile()) {
    console.error(
      `エラー: 指定された動画ファイルが見つかりません: '${videoP}'`
    );
    process.exit(1);
  }
  if (!fsSync.existsSync(clipsJsonP) || !fsSync.statSync(clipsJsonP).isFile()) {
    console.error(
      `エラー: 指定されたクリップ定義JSONが見つかりません: '${clipsJsonP}'`
    );
    process.exit(1);
  }
  if (
    !fsSync.existsSync(templateXml) ||
    !fsSync.statSync(templateXml).isFile()
  ) {
    console.error(`エラー: テンプレートXMLが見つかりません: ${templateXml}`);
    process.exit(1);
  }
  if (!fsSync.existsSync(workDir)) {
    fsSync.mkdirSync(workDir, { recursive: true });
  }
  const intermediateXml = path.join(
    workDir,
    `${path.parse(videoP).name}_sequence.xml`
  );
  let finalXmlP: string;
  if (argv.output) {
    finalXmlP = path.resolve(argv.output);
  } else {
    finalXmlP = path.join(
      workDir,
      `${path.parse(videoP).name}_final.xml`
    );
  }
  // 出力先ディレクトリ存在チェック
  const outputDir = path.dirname(finalXmlP);
  if (
    outputDir &&
    !fsSync.existsSync(outputDir) &&
    outputDir !== path.resolve(".")
  ) {
    fsSync.mkdirSync(outputDir, { recursive: true });
  }
  // 出力ファイルが既に存在する場合は自動で上書き
  if (fsSync.existsSync(finalXmlP)) {
    console.warn(
      `警告: 出力ファイル '${finalXmlP}' は既に存在します。上書きします。`
    );
  }
  // 1. シーケンスXML生成
  console.log(`[1/2] シーケンスXML生成: ${intermediateXml}`);
  const seqSuccess = await create_sequence_xml(
    templateXml,
    videoP,
    intermediateXml
  );
  if (!seqSuccess) {
    console.error(
      "create_sequence_xml の実行に失敗しました。処理を中断します。"
    );
    process.exit(1);
  }
  // 2. クリップ編集XML生成
  console.log(`[2/2] クリップ編集XML生成: ${finalXmlP}`);
  await processXml(clipsJsonP, intermediateXml, finalXmlP);
  // 3. 中間ファイル削除
  if (!argv["keep-intermediate"]) {
    try {
      if (fsSync.existsSync(intermediateXml)) {
        await fs.unlink(intermediateXml);
        console.log(`中間ファイル ${intermediateXml} を削除しました。`);
      }
    } catch (e: any) {
      console.warn(`中間ファイルの削除に失敗しました: ${e.message}`);
    }
  } else {
    console.log(
      `--keep-intermediate指定のため中間ファイル ${intermediateXml} を残します。`
    );
  }
  console.log(`\n最終XMLファイルの生成が完了しました: ${finalXmlP}`);
}

main().catch((err) => {
  console.error("未処理の例外:", err);
  process.exit(1);
});