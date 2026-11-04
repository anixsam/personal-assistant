export { fbank, type FbankOptions } from "./fbank.js";
export { decodeWav, resample, trimSilence } from "./wav.js";
export { OnnxSpeakerEmbedder, VoiceIdError, cosine, normalize, prepare, MIN_VOICED_SECONDS, type Embedder } from "./embedder.js";
export { VoiceprintStore, DEFAULT_THRESHOLD, ENROLL_SAMPLES, type Voiceprint, type VoiceIdSettings, type AccessEvent } from "./store.js";
export { hashPin, checkPin, PinGuard } from "./pin.js";

/** Stock speaker-embedding model (WeSpeaker CAM++, VoxCeleb, English), from the sherpa-onnx model releases. */
export const DEFAULT_VOICEID_MODEL = {
  file: "wespeaker_en_voxceleb_CAM++.onnx",
  url: "https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-recongition-models/wespeaker_en_voxceleb_CAM++.onnx",
};
