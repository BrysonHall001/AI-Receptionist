import twilio from "twilio";

const VoiceResponse = twilio.twiml.VoiceResponse;
const VOICE = "Polly.Joanna";

/** Speak a message and gather the caller's speech, posting back to actionPath. */
export function sayAndGather(message: string, actionPath: string): string {
  const vr = new VoiceResponse();
  const gather = vr.gather({
    input: ["speech"],
    action: actionPath,
    method: "POST",
    speechTimeout: "auto",
    timeout: 5,
    actionOnEmptyResult: true,
  });
  gather.say({ voice: VOICE }, message);
  return vr.toString();
}

/** Speak a final message and hang up. */
export function sayAndHangup(message: string): string {
  const vr = new VoiceResponse();
  vr.say({ voice: VOICE }, message);
  vr.hangup();
  return vr.toString();
}
