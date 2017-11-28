require('dotenv-extended').load();

var restify = require('restify'),
    builder = require('botbuilder'),
    calling = require('botbuilder-calling'),
    stream = require('stream'),
    MemoryStream = require('memorystream'),
    ffmpeg = require('fluent-ffmpeg'),
    speechService = require('./speech-service.js'),
    prompts = require('./prompts');

var server = restify.createServer();
server.listen(process.env.port || process.env.PORT, function() {
    console.log('%s listening to %s', server.name, server.url);
});

var chatConnector = new builder.ChatConnector({
    appId: process.env.MICROSOFT_APP_ID,
    appPassword: process.env.MICROSOFT_APP_PASSWORD
});
var chatBot = new builder.UniversalBot(chatConnector);
server.post('/api/messages', chatConnector.listen());

var connector = new calling.CallConnector({
    callbackUrl: process.env.CALLBACK_URL,
    appId: process.env.MICROSOFT_APP_ID,
    appPassword: process.env.MICROSOFT_APP_PASSWORD
});
var bot = new calling.UniversalCallBot(connector);
bot.set('storage', new builder.MemoryBotStorage());

var wolfram = require('wolfram').createClient(process.env.WOLFRAM_API_KEY)

server.post('/api/calls', connector.listen());

chatBot.dialog('/', function(session) {
    session.send(prompts.welcome);
});

bot.dialog('/', function(session) {
    session.send(prompts.welcome);
    session.beginDialog('/record');
});

bot.dialog('/record', [
    function(session) {
        calling.Prompts.record(session, prompts.record.prompt, {
            playBeep: true
        });
    },
    function(session, results) {
        if (results.response) {
            var bufferStream = new stream.PassThrough();
            bufferStream.end(results.response.recordedAudio);
            var wav = new MemoryStream();
            ffmpeg({
                    source: bufferStream
                })
                .audioFrequency(16000)
                .withAudioCodec('pcm_s16le')
                .audioChannels(1)
                .format('wav')
                .output(wav)
                .run();
            speechService.getTextFromAudioStream(wav)
                .then(function(text) {
                    if (text.match(/goodbye/i)) {
                        session.endDialog(prompts.goodbye);
                    } else {
                        wolfram.query(text, function(err, result) {
                            if (err || typeof result[1] === 'undefined')
                                session.send(prompts.wolfram.failed);
                            else if (result[1]['subpods'][0]['value'].length > 0)
                                session.send(result[1]['subpods'][0]['value']);
                            else if (result[1]['subpods'][0]['image'].length > 0)
                                session.send(result[1]['subpods'][0]['image']);
                            else
                                session.send(prompts.wolfram.failed);
                            session.beginDialog('/record');
                        });
                    }
                })
                .catch(function(error) {
                    session.send(prompts.failed);
                    console.error(error);
                });
        } else {
            session.beginDialog('/record');
        }
    }
]);