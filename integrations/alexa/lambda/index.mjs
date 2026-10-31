// SPDX-License-Identifier: AGPL-3.0-or-later
// Keeper by Ashforde® — an Alexa custom skill handler that forwards a spoken
// question to *your own* Keeper through *your own* tunnel, and reads the answer.
// Set two environment variables on the function:
//   KEEPER_URL    https://keeper.example.com   (your tunnel's host name; add it in Keeper → Agents → Gateway)
//   KEEPER_TOKEN  the gateway token shown in Keeper → Agents → Gateway
// Nothing is stored here; the question goes to your computer and the answer comes back.

const say = (text, end = true) => ({
  version: '1.0',
  response: { outputSpeech: { type: 'PlainText', text: text.slice(0, 7000) }, shouldEndSession: end },
});

export const handler = async (event) => {
  const req = event.request ?? {};
  if (req.type === 'LaunchRequest') return say('Ask me about your files. For example: ask when my lease ends.', false);
  if (req.type !== 'IntentRequest') return say('Goodbye.');
  const intent = req.intent?.name;
  if (intent === 'AMAZON.HelpIntent') return say('Say: ask, followed by your question about your files.', false);
  if (intent === 'AMAZON.StopIntent' || intent === 'AMAZON.CancelIntent') return say('Goodbye.');
  const question = req.intent?.slots?.question?.value;
  if (!question) return say('What would you like to know about your files?', false);
  try {
    const res = await fetch(`${process.env.KEEPER_URL.replace(/\/$/, '')}/v1/ask`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${process.env.KEEPER_TOKEN}` },
      body: JSON.stringify({ question }),
      signal: AbortSignal.timeout(7000),
    });
    if (!res.ok) return say('Keeper did not answer. Is your computer on and the tunnel running?');
    const { answer } = await res.json();
    // File citations like [[/path/file.pdf]] read badly aloud: keep only the file name.
    return say(String(answer).replace(/\[\[([^\]]+)\]\]/g, (_, p) => p.split(/[\\/]/).pop()));
  } catch {
    return say('Keeper took too long to answer. Try a shorter question.');
  }
};
