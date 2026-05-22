import { bytesToHex } from '../utils/hash.js';
import { extractFingerprint } from './sdp.js';

export const STUN_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
];

/**
 * Pre-generates the DTLS cert (step 0 of the pairing flow) and installs it into the
 * RTCPeerConnection that will host the file-transfer DataChannel. `localFp` is the
 * canonical fingerprint hex of the cert and is stable for the lifetime of this connection.
 */
export interface PrebuiltConnection {
  pc: RTCPeerConnection;
  localFp: string;
}

export async function createPeerConnection(): Promise<PrebuiltConnection> {
  const cert = await RTCPeerConnection.generateCertificate({
    name: 'ECDSA',
    namedCurve: 'P-256',
  } as AlgorithmIdentifier);
  const pc = new RTCPeerConnection({
    certificates: [cert],
    iceServers: STUN_SERVERS,
  });

  // The browser only exposes the cert fingerprint inside the SDP it produces.
  // Generate a stub offer just to read out the fingerprint, then roll back. We do this on
  // a separate transient RTCPeerConnection to avoid disturbing the real one's signaling state.
  const localFp = await readCertFingerprint(cert);

  return { pc, localFp };
}

async function readCertFingerprint(cert: RTCCertificate): Promise<string> {
  // Some browsers expose getFingerprints() directly on the cert object.
  const withFp = cert as RTCCertificate & {
    getFingerprints?: () => { algorithm: string; value: string }[];
  };
  if (typeof withFp.getFingerprints === 'function') {
    const fps = withFp.getFingerprints();
    const sha256 = fps.find((f) => (f.algorithm ?? '').toLowerCase() === 'sha-256');
    if (sha256 && sha256.value) {
      return sha256.value.replace(/:/g, '').toLowerCase();
    }
  }
  // Fallback: spin up a throwaway pc with this cert, generate an offer, and parse the SDP.
  const tmp = new RTCPeerConnection({ certificates: [cert] });
  try {
    // We need a media section so that the SDP includes a=fingerprint. A data channel works.
    tmp.createDataChannel('_fp');
    const offer = await tmp.createOffer();
    return extractFingerprint(offer.sdp!);
  } finally {
    tmp.close();
  }
}

void bytesToHex; // re-exported via utils/hash
