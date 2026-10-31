# Keeper by Ashforde® for Alexa (template)

Ask Alexa about your files: *“Alexa, ask my keeper when my lease ends.”*

Amazon only lets this run as a **custom skill in your own Amazon developer account**, and Alexa can only reach a computer over the internet, so it needs your own tunnel to Keeper. Nothing goes through a Keeper server.

1. In Keeper: **Devices → tunnel** (cloudflared) to give your computer a host name, then **Agents → Gateway**: switch the gateway on, add that host name under *Reach it from elsewhere*, and copy the token.
2. In the Alexa developer console: create a custom skill, paste `interaction-model.json` into the JSON editor, and build it.
3. Create an AWS Lambda function (Node.js 20 or later) from `lambda/index.mjs`, set `KEEPER_URL` and `KEEPER_TOKEN`, and add the Alexa Skills Kit trigger with your skill's ID. Set the skill's endpoint to the function.
4. Test in the developer console, then on your devices (the skill stays private to your account).

Honest notes: Alexa allows about eight seconds per answer, so long questions may time out; the answer is read aloud on whatever device you ask, so keep private questions for private rooms; anyone who knows the token can ask your Keeper — keep it secret and use *New token* in Keeper if it leaks. This template was written from Amazon's documented request format and has not been run against a live Alexa device.
