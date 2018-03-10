'use strict';
const AWS = require('aws-sdk');
const dropboxV2Api = require('dropbox-v2-api');
var search = require('youtube-search');
var google = require('./node_modules/googleapis');
const ytdl = require('ytdl-core');
var Stream = require('stream');
var url = 'http://youtube.com/watch?v='
var fs = require('fs');
var API_KEY = process.env['API_KEY'];
var EVENT_DATE = process.env['EVENTDATE'];
var dropbox_token = process.env['DROPBOX_TOKEN'];
var ffmpeg = require('fluent-ffmpeg');
const ical = require('ical');
const utils = require('util');

const dropbox = dropboxV2Api.authenticate({
    token: dropbox_token
});

const URL = "https://calendar.google.com/calendar/ical/3h3ivlvmis8ip9m282okkhuv7k%40group.calendar.google.com/public/basic.ics";
const dateOutOfRange = "Date is out of range please choose another date";
const eventSummary = "The %s event is, %s at %s on %s ";
const oneEventMessage = "There is 1 event ";
const multipleEventMessage = "There are %d events ";
const NoDataMessage = "Sorry there aren't any events scheduled. Would you like to search again?";
const eventNumberMoreInfoText = "You can say the event number for more information.";
const scheduledEventMessage = "scheduled for this time frame. I've sent the details to your Alexa app: ";
const cardContentSummary = "%s at %s which starts at %s ";
const cardTitle = "Events";

const i18n_en = {
    "SKILL_TITLE": "Redmond Tamil Assembly",
    "SKILL_NAME" : "TamilAssembly",
    "ANNOUNCEMENT": "The next meeting is  "+ EVENT_DATE + ".",
    "WELCOME_MESSAGE": 'Welcome to Redmond Tamil Assembly. Would you like to listen our last audio?',
    "CONNECTION_ISSUE": 'Environment Variable not set or unable to connect to the DROPBOX! ',
    "UNABLE_TO_PROCESS": "I'm sorry I didn't understand what you said",
    "YTUBE_CONNECTION_ERROR": "I got an error from the Youtube API.",

}

const audioOutput = '/tmp/sound.m4a'
const mainOutput = '/tmp/output.m4a'
const dbfile = 'audio.mp4'
var maxdata = 1048576000 // default max data limit - this is deliberately set to 1000MB rather than 1 Gig to allow headroom for settings.js transfers plus any other skills running
var datachargerate = 0.090 // this is the AWS Data transfer charge per Gigabyte first 10 TB / month data transfer out beyond the global free tier 

var destructrequestactive = false


process.env['PATH'] = process.env['PATH'] + ':' + process.env['LAMBDA_TASK_ROOT'];

var maxresults = 25
var partsize = 60*30 // size of the audio chunks in seconds

if (process.env['PART_SIZE_SECS']){
    partsize = process.env['PART_SIZE_SECS']
    console.log('Partsize over-ridden to ', partsize)
}

if (process.env['MAX_RESULTS']){
    maxresults = process.env['MAX_RESULTS']
    console.log('Max results over-ridden to ', maxresults)
}
if (process.env['MAX_DATA']){
    maxdata = process.env['MAX_DATA']
    console.log('Max data over-ridden to ', maxdata)
}
if (process.env['CHARGE_PER_GIG']){
    datachargerate = process.env['CHARGE_PER_GIG']
    console.log('Data charge rate over-ridden to ', datachargerate)
}

var opts = {
  maxResults: maxresults,
    type: 'video',
    key: API_KEY
};

var settings = new Object();
var streamURL;
 
exports.handler = function(event, context) {
    var player = new alextube(event, context);
    player.handle();
};
 
var alextube = function (event, context) {
    this.event = event;
    this.context = context;
};
 
 
alextube.prototype.handle = function () {
    var requestType = this.event.request.type;
    var userId = this.event.context ? this.event.context.System.user.userId : this.event.session.user.userId;
    
    console.log(JSON.stringify(this.event))
 
 
   if (requestType === "LaunchRequest") {
       
     this.speak(i18n_en.WELCOME_MESSAGE, true)
 
 
    } else if (requestType === "IntentRequest") {
        var intent = this.event.request.intent;
        
        if (!process.env['API_KEY']){
            this.speak(i18n_en.CONNECTION_ISSUE)
        }        
        
        if (!process.env['DROPBOX_TOKEN']){
            this.speak(i18n_en.CONNECTION_ISSUE)
        }
        
        if (destructrequestactive == true && intent.name === "DestructCode") {
 
        console.log('Recieved Destuct')
            destructrequestactive = false;
            this.raisemax()
        
        } else if (destructrequestactive == false && intent.name === "DestructCode") {
 
        console.log('Recieved Destuct')
            this.speak('You must ask to raise the data limit before using this code')
        
        } else if (destructrequestactive == true && intent.name !== "DestructCode") {
 
        console.log('Did not receive Destuct code')
            destructrequestactive = false;
            this.speak('You did not give a correct code')
        
        }
        else {
            destructrequestactive = false
        }
        if(intent.name === "AnnouncementIntent"){
            var meetingSlot = "";
            if(this.event.request.intent.slots){
                meetingSlot = this.event.request.intent.slots.meeting.value;
            }
            if(meetingSlot == undefined){
                searchFunction.speak(i18n_en.UNABLE_TO_PROCESS)
            }
            else {

                this.speak(i18n_en.ANNOUNCEMENT, false);
            }

        }
        else if(intent.name === "calendarIntent"){
           this.searchCalendar();
        }
        else if ((intent.name === "SearchIntent") || (intent.name === "AMAZON.YesIntent")) {
            
            var foundTitle;
            var searchFunction = this

        
        console.log('Starting Search Intent'+ JSON.stringify(this.event.request.intent))

        var alexaUtteranceText = i18n_en.SKILL_TITLE;
            var optRequest = "latest";

            if(this.event.request.intent.slots){
                optRequest = this.event.request.intent.slots.search.value;
                if(alexaUtteranceText.indexOf("week") != -1)
                {
                    optRequest = "week";
                }
            }

        console.log ('Search term is : - '+ alexaUtteranceText);
            
            if (!alexaUtteranceText){
                searchFunction.speak(i18n_en.UNABLE_TO_PROCESS)
            }
        search(alexaUtteranceText, opts, function(err, results) {
          if(err) {
              console.log(err)
              searchFunction.speakWithCard(i18n_en.YTUBE_CONNECTION_ERROR)
          }
            else {
                console.log('number of results is', results.length)
                settings.results = results
                settings.currentresult = 0
                settings.previousURL = null;
                settings.previousresult = 0;
                var tracksettings= [];
                var playlist=[];
                for (var count = 0; count <= results.length-1; count++) {
                    var readDate = new Date(results[count].publishedAt);
                    playlist[count] = 'Published on ' +  readDate.toDateString() +': ' + results[count].title
                    
                    var object = {
                      "id": count,
                        "title": results[count].title,
                      "duration": null,
                        "parts": null,
                        "currentpart": 0
                        
                    }
                    tracksettings.push(object)


                }
                settings.tracksettings = tracksettings;
                settings.playlist = playlist
                searchFunction.saveSettings(function(err, result)  {
                    if (err) {
                        console.log('There was an error saving settings to dropbox', err)
                        searchFunction.speakWithCard('I got an error from the Dropbox API. Check the API Token has been copied into the Lambda environment variable properly, with no extra spaces before or after the Token', 'YOUTUBE DROPBOX ERROR', 'I got an error from the Dropbox API. \nCheck the Token has been copied into the DROPBOX_TOKEN Lambda environment variable properly, with no extra spaces before or after the Token')
                        
                    } else {
                        
                        searchFunction.loadSettings(function(err, result)  {
                            if (err) {
                                searchFunction.speak('There was an error loading settings from dropbox')
                            } else {
                                if (typeof settings.autoplay == 'undefined'){
                                    console.log('No autoplay setting exists - creating')
                                    settings.autoplay ='on'
                                } 
                                
                                if (typeof settings.shuffle == 'undefined'){
                                    console.log('No shuffle setting exists - creating')
                                    settings.shuffle = 'off'
                                }
                                if (typeof settings.loop == 'undefined'){
                                    console.log('No loop setting exists - creating')
                                    settings.loop = 'off'
                                }
                                if (typeof settings.dataused == 'undefined'){
                                    console.log('No dataused setting exists - creating')
                                    settings.dataused = 0
                                }                                
                                
                                if (typeof settings.maxdata == 'undefined'){
                                    console.log('No maxdata setting exists - creating')
                                    settings.maxdata = maxdata
                                }
                                if (typeof settings.currentmonth == 'undefined'){
                                    console.log('No month setting exists - creating')
                                    var timedate = new Date();
                                    settings.currentmonth = timedate.getMonth();
                                }
                                var timedatecheck = new Date();
                                var currentmonth = timedatecheck.getMonth();
                                
                                if (settings.currentmonth !== currentmonth )
                                    console.log('******New month detected - resetting stats*******')
                                    settings.currentmonth = currentmonth
                                    settings.dataused = 0
                                    settings.maxdata = maxdata
                                
                                if (settings.shuffle == 'on'){
                                    settings.currentresult = Math.floor((Math.random() * (results.length-1) ));
                                }
                                
                                if (settings.dataused >= settings.maxdata){
                                    searchFunction.speakWithCard('Maximum monthly data usage exceeded', 'WARNING', 'Maximum monthly data usage exceeded')
                                }
                                
                                console.log('Max data usage setting in GB ', settings.maxdata/1048576)
                                console.log('Current data usage in GB ', settings.dataused/1048576)
                                
                                searchFunction.processResult(0, null, 0);

          
                            }
                        });
                    
                    }
                });
                
            }

        });
        
        } else if (intent.name === "NowPlayingIntent") {
        console.log('Starting Now playing Intent')
            var nowfunction = this;
            this.loadSettings(function(err, result)  {
                if (err) {
                    nowfunction.speak('There was an error loading settings from dropbox')
                } else {
                    var currentresult = settings.currentresult
                    var enqueuestatus = settings.enqueue
                     if (enqueuestatus == true){
                        console.log('Song already enqueued')
                        currentresult--
                     }
                    var results = settings.results 
                    var title = results[currentresult].title
                    var cardTitle = "📺 Playing - " + title + ' 📺'
                    var cardText = nowfunction.createPlaylist(currentresult)
                    nowfunction.speakWithCard('Currently Playing ' + title, cardTitle, cardText)
                }
            });
        } 
        else if (intent.name === "AutoOn") {
 
        console.log('Starting Auto On Intent')
            this.autoMode('on')
    

            

        
        } else if (intent.name === "AutoOff") {
 
        console.log('Starting Auto Off Intent')
            this.autoMode('off')
        
        }else if (intent.name === "ResetLimit") {
 
        console.log('Received Reset limit')
            this.resetmax()
        
        }else if (intent.name === "RaiseLimit") {
 
        console.log('Received Raise limit')
            destructrequestactive = true;
            this.speak('Request to raise data limit received. Please give the authorisation code', true)
        
        } else if (intent.name === "NumberIntent") {
 
        console.log('Starting number Intent')
            var number = this.event.request.intent.slots.number.value;
            this.numberedTrack(number)

        
        }else if (intent.name === "AMAZON.StopIntent") {
 
        console.log('Starting number Intent')
            console.log('Running STOP intent')
            this.stop();

        
        } else if (intent.name === "AMAZON.PauseIntent") {
            console.log('Running pause intent')
            this.stop();
 
        } else if (intent.name === "AMAZON.CancelIntent") {
            this.speak(' ')
            
        } else if (intent.name === "AMAZON.NextIntent") {
            this.next();
      
        } else if (intent.name === "AMAZON.PreviousIntent") {
            this.previous();
    
        } else if (intent.name === "AMAZON.ShuffleOffIntent") {
            this.shuffle('off');
    
        } else if (intent.name === "AMAZON.ShuffleOnIntent") {
            this.shuffle('on');
    
        }else if (intent.name === "AMAZON.LoopOnIntent") {
            this.loop('on');
    
        }else if (intent.name === "AMAZON.LoopOffIntent") {
            this.loop('off');
    
        }else if (intent.name === "AMAZON.RepeatIntent") {
            this.speak('Repeat is not supported by the youtube skill');
    
        }else if (intent.name === "AMAZON.StartOverIntent") {
            this.numberedTrack(1)

        }else if (intent.name === "AMAZON.HelpIntent") {
            this.help()

        } else if (intent.name === "AMAZON.ResumeIntent") {
            console.log('Resume called')
            var resumefunction = this;
            this.loadSettings(function(err, result)  {
            if (err) {
                resumefunction.speak('There was an error loading settings from dropbox')
            } else {
                var lastPlayed = settings.lastplayed
                var offsetInMilliseconds = 0;
                var token = resumefunction.createToken;
                var results = resumefunction.results;
                var currentresult = settings.currentresult
                var previousresult = settings.previousresult

                
                var currenturl = settings.currentURL;
                                
                if (lastPlayed !== null) {
                    console.log(lastPlayed);
                    offsetInMilliseconds = lastPlayed.request.offsetInMilliseconds;
                    token = settings.currenttoken;
                }
                if (offsetInMilliseconds < 0){
                    offsetInMilliseconds = 0
                }
                
                if (settings.enqueue == true){
                    console.log('RESUME INTENT Track already enqueued')
                    settings.enqueue = false
                    var tracksettings = settings.tracksettings[currentresult]
                    var currentpart = tracksettings.currentpart
                    var totalparts = tracksettings.parts
                    console.log('RESUME INTENT CurrentResult is', currentresult)
                    console.log('RESUME INTENT Currentpart is', currentpart)
                    console.log('RESUME INTENT Offset is', offsetInMilliseconds)
                    
                    if (currentresult !== previousresult){
                        // 
                        console.log('RESUME INTENT Next track already cued')
                        settings.currentresult = previousresult
                        currentpart = settings.tracksettings[previousresult].currentpart
                        
                        resumefunction.processResult(currentpart, null, offsetInMilliseconds)
  
                        
                    } else {
                        
                        // assume we are on the same track so play the previous part
                        console.log('RESUME INTENT Next part already cued')
                        tracksettings.currentpart--;
                        
                        if (tracksettings.currentpart < 0){
                            tracksettings.currentpart = 0
                        }
                        console.log('RESUME INTENT Queueing part ', tracksettings.currentpart)
                        settings.tracksettings[currentresult].currentpart = tracksettings.currentpart;
                        resumefunction.processResult(tracksettings.currentpart, null,offsetInMilliseconds)
                    }
                    
                } else {
                    console.log('current URL is ' + currenturl)
                
                resumefunction.resume(currenturl, offsetInMilliseconds, token);
                    
                }
                

                }
            });
            
        }
    } 
    else if (requestType === "AudioPlayer.PlaybackStopped") {
        console.log('Playback stopped')
        var playbackstoppedfunction = this;
        
        this.loadSettings(function(err, result)  {
            if (err) {
                playbackstoppedfunction.speak('There was an error loading settings from dropbox')
            } else { 
                settings.lastplayed = playbackstoppedfunction.event
                playbackstoppedfunction.saveSettings(function(err, result)  {
                    if (err) {
                        console.log('There was an error saving settings to dropbox', err)
                    } else {
                        
                    }
                });
            }

        });

        
    }
    else if (requestType === "AudioPlayer.PlaybackPause") {
        console.log('Playback paused')
        
        
    }
    else if (requestType === "AudioPlayer.AudioPlayer.PlaybackFailed") {
        console.log('Playback failed')
        console.log(this.event.request.error.message)
        
        
    } 
    else if (requestType === "AudioPlayer.PlaybackStarted") {
        console.log('Playback started')
        
        
        var playbackstartedfunction = this;
        console.log(playbackstartedfunction.event)
        
        this.loadSettings(function(err, result)  {
            if (err) {
                playbackstartedfunction.speak('There was an error loading settings from dropbox')
            } else { 
                settings.lastplayed = playbackstartedfunction.event
                settings.enqueue = false;
                settings.currentlyplaying = playbackstartedfunction.event
                var results = settings.results
                var currentresult = settings.currentresult
                settings.currenttitle = results[currentresult].title
                
                playbackstartedfunction.saveSettings(function(err, result)  {
                    if (err) {
                        console.log('There was an error saving settings to dropbox', err)
                    } else {
                        
                    }
                });
            }

        });
        
    }
    else if (requestType === "AudioPlayer.PlaybackNearlyFinished") {
        console.log('Playback nearly finished')
        var finishedfunction = this;
        var token = this.event.request.token;
        console.log('Token from request is', token)
        // PlaybackNearlyFinished Directive are prone to be delivered multiple times during the same audio being played.
        //If an audio file is already enqueued, exit without enqueuing again.
        
                this.loadSettings(function(err, result)  {
                if (err) {
                    finishedfunction.speak('There was an error loading settings to dropbox')
                } else {
                    
                    if (settings.enqueue == true){
                        console.log("NEARLY FINISHED Track already enqueued")
                    } else {
                        console.log("NEARLY FINISHED Nothing already enqueued")
                        var results = settings.results 
                        var current = settings.currentresult

                        settings.currenttoken = token
                        var tracksettings = settings.tracksettings[current]
                        var currentpart = tracksettings.currentpart
                        var totalparts = tracksettings.parts
                        console.log('NEARLY FINISHED Currentpart is', currentpart)
                        console.log('NEARLY FINISHED Total parts ', totalparts)

                        if (currentpart <= (totalparts -2)){
                            currentpart++
                            settings.tracksettings[current].currentpart = currentpart
                            console.log('NEARLY FINISHED Queueing part ', currentpart)
                            settings.enqueue = true
                            finishedfunction.processResult(currentpart, 'enqueue', 0);

                        } else {
                            console.log('NEARLY FINISHED No parts left - queueing next track')

                            settings.previousresult = current
                            if (settings.shuffle == 'on'){
                                settings.currentresult = Math.floor((Math.random() * (results.length-1) ));
                                settings.tracksettings[settings.currentresult].currentpart = 0
                                settings.enqueue = true
                                finishedfunction.processResult(0, 'enqueue', 0);
                            }

                            else if (current >= results.length-1){
                                if (settings.loop == 'on'){
                                    settings.currentresult = 0
                                   settings.tracksettings[settings.currentresult].currentpart = 0
                                    settings.enqueue = true
                                    finishedfunction.processResult(0, 'enqueue', 0);
                                } else {
                                console.log('end of results reached')
                                }
                            } else if(settings.autoplay == 'off'){
                                console.log('Autoplay is off')
                            }
                            else {
                                current++;
                                settings.currentresult = current;
                                settings.enqueue = true
                                finishedfunction.processResult(0, 'enqueue', 0);

                            }
                        }
                    }
                }
            });
        }
    
};
 
 alextube.prototype.play = function (audioURL, offsetInMilliseconds,  tokenValue) {

    var results = settings.results
    var currentresult = settings.currentresult
    var title = results[currentresult].title

    var playlistText = this.createPlaylist(currentresult); 
    var responseText = 'Playing ' + title;

    var response = {
    version: "1.0",
    response: {
        shouldEndSession: true,
        "outputSpeech": {
          "type": "PlainText",
          "text": responseText,
        },
        "card": {
          "type": "Standard",
          "title": "📺 Playing - " + title + ' 📺',
          "text": playlistText
        },
                directives: [
            {
                type: "AudioPlayer.Play",
                playBehavior: "REPLACE_ALL", 
                audioItem: {
                    stream: {
                        url: audioURL,
                        token: tokenValue, 
                        expectedPreviousToken: null, 
                        offsetInMilliseconds: offsetInMilliseconds
                    }
                }
            }
        ]
    }
    };
    console.log('Play Response is')
    console.log(JSON.stringify(response))
    this.context.succeed(response);
}; 

alextube.prototype.resume = function (audioURL, offsetInMilliseconds, tokenValue) {
    
    var resumeResponse = {
    version: "1.0",
    response: {
        shouldEndSession: true,

        directives: [
            {
                type: "AudioPlayer.Play",
                playBehavior: "REPLACE_ALL", 
                audioItem: {
                    stream: {
                        url: audioURL,
                        streamFormat: "AUDIO_MP4",
                        expectedPreviousToken: null, 
                        offsetInMilliseconds: offsetInMilliseconds,
                        //offsetInMilliseconds: 0,
                        token: tokenValue
                    }
                }
            }
        ]
    }
    };
    console.log('Resume Response is')
    console.log(JSON.stringify(resumeResponse))
    this.context.succeed(resumeResponse);
};

 alextube.prototype.enqueue = function (audioURL, offsetInMilliseconds, tokenValue, previousToken) {

    var response = {
        version: "1.0",
        response: {
            shouldEndSession: true,
            directives: [
                {
                    type: "AudioPlayer.Play",
                    playBehavior: "ENQUEUE", 
                    audioItem: {
                        stream: {
                            url: audioURL,
                            streamFormat: "AUDIO_MP4",
                            token: tokenValue, 
                            expectedPreviousToken: previousToken, 
                            offsetInMilliseconds: offsetInMilliseconds
                        }
                    }
                }
            ]
        }
    };
    console.log('Enqueue Response is')
    console.log(JSON.stringify(response))
    this.context.succeed(response);
};
 
alextube.prototype.stop = function () {
    console.log("Sending stop response")
    var response = {
        version: "1.0",
        response: {
            shouldEndSession: true,
            directives: [
                {
                    type: "AudioPlayer.Stop"
                }
            ]
        }
    };
    this.context.succeed(response);
};

alextube.prototype.next = function () {
    console.log("Next function")
    
    var nextfunction = this;
    var playingtoken = this.event.request.token;
    this.loadSettings(function(err, result)  {
        if (err) {
            nextfunction.speak('There was an error loading settings from dropbox')
        } else {
            var enqueuestatus = settings.enqueue
            var currenttoken = settings.currenttoken
            var url = settings.currentURL
            var results = settings.results 
            var current = settings.currentresult
            var previous = settings.previousresult
            
            if (enqueuestatus == true && current !== previous){
                console.log('Song already enqueued')
                
                nextfunction.play(url, 0, currenttoken)
            }
            

            else if (settings.shuffle == 'on'){
                
                settings.currentresult = Math.floor((Math.random() * (results.length-1) ));
                nextfunction.processResult(0, null, 0);
                
            } else{
                console.log('Enqueuing song')
                if (current >= results.length-1){
                    if (settings.loop == 'on'){
                        settings.currentresult = 0
                        nextfunction.processResult(0, null, 0);
                    } else {
                    nextfunction.speak('End of playlist reached')
                    }
                } else {
                    current++;
                    settings.currentresult = current;
                    nextfunction.processResult(0, null, 0);
                }
            }
        }
    });

};

alextube.prototype.nextResult = function () {
    console.log("Next Result function")
    
    var nextfunction = this;
    var results = settings.results
    var current = settings.currentresult
    
    if (current >= results.length-1){
        nextfunction.speak('End of playlist reached')
    } else {
        current++;
        settings.currentresult = current;
        nextfunction.processResult(0, null, 0);
    }


};

alextube.prototype.previous = function () {
    console.log("Previous function")
    
    var previousfunction = this;
    var playingtoken = this.event.request.token;
    this.loadSettings(function(err, result)  {
        if (err) {
            previousfunction.speak('There was an error loading settings from dropbox')
        } else {
            var enqueuestatus = settings.enqueue
            var currenttoken = settings.currenttoken
            var url = settings.currentURL
            var results = settings.results 
            var current = settings.currentresult
            if (enqueuestatus == true){
                console.log('Song already enqueued')
                current = current - 2
                if (current < 0){
                    previousfunction.speak('Already at beginning of playlist')
                } else {
                    settings.currentresult = current;
                    previousfunction.processResult(0, null, 0);
                }                     
            } else {
                console.log('Enqueuing song')
                current = current -1
                if (current < 0){
                    previousfunction.speak('Already at beginning of playlist')
                } else {
                    settings.currentresult = current;
                    previousfunction.processResult(0, null, 0);
                }
            }
        }
    });

};

alextube.prototype.processResult = function (partnumber, enqueue, offset) {
    console.log("Processing result")
    if(enqueue){
        settings.enqueue = true
    }
    if(!offset){
        offset=0
    }
    var results = settings.results
    var currentresult = settings.currentresult
    var url = results[currentresult].id;
    var foundTitle = results[currentresult].title;
    var playFunction = this;
    console.log("URL "+ url);
    var audioStreamInfo = ytdl.getInfo(url, { filter: function(format) { return format.container === 'm4a'; } }, function (err,info){
        console.log(info)
        var contentduration = 0;
        if(info == undefined)
            contentduration = 60*60;
        else
            contentduration = info.length_seconds;
        settings.tracksettings[currentresult].duration = contentduration
        console.log ('Duration is ', contentduration)
        
        // ignore contetn lobger than 7 hours as the Lambda function will run out of space!!!
        if (contentduration > 60*60*7){
            
            console.log('Audio longer than 7 hours - for track', currentresult)
            settings.playlist[currentresult] = settings.playlist[currentresult] + 'TRACK TOO LONG TO PLAY!'
            playFunction.nextResult();

            
        } else if (contentduration = 0){
            
            console.log('Audio not found', currentresult)
            settings.playlist[currentresult] = settings.playlist[currentresult] + 'TRACK NOT PLAYABLE!'
            playFunction.nextResult();

            
        } else {
         var parts = Math.ceil(contentduration / partsize)
        settings.tracksettings[currentresult].parts = parts
        console.log ('Number of parts is ', parts)
        if (!partnumber ){
            partnumber = 0
        } 
        
        else if (partnumber > (parts-1) || partnumber < 0){
            console.log('Part number invalid')
            partnumber = 0
        }
        
        console.log('Part to be processed is ', partnumber)
        settings.tracksettings[currentresult].currentpart = partnumber
        
        
        var starttime = partsize * partnumber
        
        
        console.log ('start secs ', starttime)
        
            ytdl(url, { filter: format => {
              return format.container === 'm4a';  } })
              // Write audio to file since ffmpeg supports only one input stream.
              .pipe(fs.createWriteStream(audioOutput))

              .on('finish', () => {
                
                var test = ffmpeg()
              //  .input(ytdl(url, { filter: format => {
              //    return format.container === 'm4a';  } }))
                  //.videoCodec('copy')
                  .input(audioOutput)
                .inputFormat('m4a')
                    .seekInput(starttime)
                .duration(partsize)
                  .audioCodec('copy')
                .outputOptions('-movflags faststart')
                  .save(mainOutput)
                  .on('error', console.error)
                    .on('end', () => {
                    fs.unlink(audioOutput, err => {
                      if(err) console.error(err);
                        
                        
                        
                        var stats = fs.statSync(mainOutput)
                        var fileSizeInBytes = stats.size
                        var overalldata = settings.dataused + fileSizeInBytes
                        console.log('Max data usage setting in GB ', settings.maxdata/1000000.0)
                        console.log('Current data usage in GB ', settings.dataused/1000000.0)
                        console.log('Data usage following this song in GB ', overalldata/1000000.0)
                        
                        if (overalldata >= settings.maxdata){
                            
                            
                            playFunction.speakWithCard('Maximum monthly data usage reached', 'WARNING', 'Maximum monthly data usage reached')
                            
                            
                        } else {
                            
                            settings.dataused = overalldata;

                            var audioFileName = url+'.m4a';
                            playFunction.upload(audioFileName, enqueue, offset);
                        
                        }
               
                        
                    });
                  });
               //     test.pipe(dropboxUploadStream);
             
              });
            
            
        }
 
    })
    
};


alextube.prototype.speak = function (responseText, ask) {
    //console.log('speaking result')
    var session = true
    if (ask){
        session = false
    }
    var response = {
        version: "1.0",
        "sessionAttributes": {},
        response: {
            "outputSpeech": {
              "type": "PlainText",
              "text": responseText,
            },
            "shouldEndSession": session
        }
        
    };
    this.context.succeed(response);
};

alextube.prototype.speakWithCard = function (responseText, cardTitle, cardText) {
    //console.log('speaking result')
    var response = {
        version: "1.0",
        "sessionAttributes": {},
        response: {
            "outputSpeech": {
              "type": "PlainText",
              "text": responseText,
            },
            "card": {
              "type": "Standard",
              "title": cardTitle,
              "text": cardText
            },
            "shouldEndSession": true
        }
        
    };
    this.context.succeed(response);
};

alextube.prototype.autoMode = function (mode) {
    console.log('changing auto play mode')
    
    var autofunction = this;
            
        
        this.loadSettings(function(err, result)  {
            if (err) {
                autofunction.speak('There was an error loading settings from dropbox')
            } else { 
                settings.autoplay = mode
                settings.enqueue = false
                autofunction.saveSettings(function(err, result)  {
                    if (err) {
                        console.log('There was an error saving settings to dropbox', err)
                    } else {
                        autofunction.speak('Autoplay mode is ' + mode)
                    }
                });
            }

        });

};

alextube.prototype.shuffle = function (mode) {
    
    var shufflefunction = this;

        this.loadSettings(function(err, result)  {
            if (err) {
                shufflefunction.speak('There was an error loading settings from dropbox')
            } else { 
                settings.shuffle = mode
                settings.enqueue = false
                shufflefunction.saveSettings(function(err, result)  {
                    if (err) {
                        console.log('There was an error saving settings to dropbox', err)
                    } else {
                        
                        shufflefunction.speak('Shuffle mode is ' + mode)
                    }
                });
            }

        });

};

alextube.prototype.loop = function (mode) {
    console.log('changing shuffle mode')
    
    var loopfunction = this;
            
        
        this.loadSettings(function(err, result)  {
            if (err) {
                loopfunction.speak('There was an error loading settings from dropbox')
            } else { 
                settings.loop = mode
                settings.enqueue = false
                loopfunction.saveSettings(function(err, result)  {
                    if (err) {
                        console.log('There was an error saving settings to dropbox', err)
                    } else {
                        
                        loopfunction.speak('Loop mode is ' + mode)
                    }
                });
            }

        });

};

alextube.prototype.resetmax = function () {
    console.log('Resetting data limit')
    
    var resetfunction = this;
    
            
        
        this.loadSettings(function(err, result)  {
            if (err) {
                resetfunction.speak('There was an error loading settings from dropbox')
            } else { 
                settings.maxdata = maxdata
                
                resetfunction.saveSettings(function(err, result)  {
                    if (err) {
                        console.log('There was an error saving settings to dropbox', err)
                    } else {
                        
                        resetfunction.speak('Monthly Data limit has been reset to default of ' + Math.ceil(settings.maxdata/1048576) + 'Megabytes. Current usage this month is ' + Math.ceil(settings.dataused/1048576) + 'Megabytes.')
                    }
                });
            }

        });

};

alextube.prototype.raisemax = function () {
    console.log('Raising data limit')
    
    var raisefunction = this;
    

        this.loadSettings(function(err, result)  {
            if (err) {
                raisefunction.speak('There was an error loading settings from dropbox')
            } else { 
                settings.maxdata = settings.maxdata + maxdata
                
                raisefunction.saveSettings(function(err, result)  {
                    if (err) {
                        console.log('There was an error saving settings to dropbox', err)
                    } else {
                        
                        raisefunction.speak('Monthly Data limit has been increased to ' + Math.ceil(settings.maxdata/1048576) + 'Megabytes. Current usage this month is ' + Math.ceil(settings.dataused/1048576) + 'Mega bytes. Warning. Additional use of this skill may be subject to amazon AWS Bandwidth charges, which are ' + datachargerate + ' US dollars per gigabyte. See the Now Playing card in the Alexa app for current estimated costs')
                    }
                });
            }

        });

};

alextube.prototype.numberedTrack = function (number) {
    console.log('Numbered track function')
    
            var numfunction = this;
            this.loadSettings(function(err, result)  {
            if (err) {
                numfunction.speak('There was an error loading settings from dropbox')
            } else {
                var enqueuestatus = settings.enqueue
                var currenttoken = settings.currenttoken
                var url = settings.currentURL
                var results = settings.results 
                var current = settings.currentresult
                
                if (number > results.length || number < 1 ){
                    numfunction.speak('That is not a valid selection')
                } else {
                    
                    
                    settings.currentresult = number-1;
                    settings.tracksettings[settings.currentresult].currentpart = 0
                    numfunction.processResult(0, null, 0);
                }            
            }
        });

};



 
alextube.prototype.saveSettings = function (callback) {
    // add the writing of this file to the data used (we have to estimate the filesize as being 24KB)
    settings.dataused = settings.dataused + 24576
    var wstream = fs.createWriteStream('/tmp/settings.js');
    wstream.write(JSON.stringify(settings));
    wstream.end();
    wstream.on('finish', function () {
      //console.log('seetings file has been written');
        const dropboxUploadlastplayed = dropbox({
                resource: 'files/upload',
                parameters: {
                    path: '/youtube-skill/settings.js',
                    mode: 'overwrite',
                    mute: true
                }
            }, (err, result) => {
                if (err){
                    console.log('There was an error')
                    callback(err, null);
                } else if (result){
                      
                    callback(null, result);
                    
                }
            });
        fs.createReadStream('/tmp/settings.js').pipe(dropboxUploadlastplayed);
    });

   

};
 
alextube.prototype.loadSettings = function (callback) {
    
    const savefile = fs.createWriteStream('/tmp/settings.js')
    dropbox({
        resource: 'files/download',
        parameters: {
            path: '/youtube-skill/settings.js'
        }
        }, (err, result) => {
            if (err){
                    console.log('There was an error downloading file from dropbox')
                    callback(err, null);
                
                
                    
                } else if (result){
                    
                    //savefile.end();
                    
                }
        }).pipe(savefile);
    
            
    
    savefile.on('finish', function () {
        
        fs.readFile('/tmp/settings.js', 'utf8', onFileRead);

        function onFileRead(err, data) {  
          if (err) {
            console.log('There was an error reading settings file from /tmp')
             callback(err, null); 
          } else {
              
              settings = JSON.parse(data);
              callback(null, {});
              
          }
        }
        
        
    })
               
    };

alextube.prototype.createToken = function() {

  var d = new Date().getTime();

  var uuid = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {

    var r = (d + Math.random()*16)%16 | 0;

    d = Math.floor(d/16);

    return (c=='x' ? r : (r&0x3|0x8)).toString(16);

  });

  return uuid;

}
alextube.prototype.createPlaylist = function(currentresult) {
    
    var results = settings.results
     
     var title = results[currentresult].title
     var description = results[currentresult].description
     var smallImageUrl = results[currentresult].thumbnails.high.url
     var link = results[currentresult].link
     var channel = results[currentresult].channelTitle
     var tracklist = '';
     for (let count = 0; count <= results.length-1; count++) {

            
         if (count == currentresult){
             tracklist = tracklist + '🔊  '
         } 
         tracklist = tracklist + settings.playlist[count]
        if (count == currentresult){
             tracklist = tracklist + '  🔊'
         }
         tracklist = tracklist + '\n'
        }
    var costs = 0
    var billabledata = settings.dataused - maxdata
    if (billabledata > 0){
        
        costs = ((datachargerate/1073741824)*billabledata).toFixed(2);
        
    } 
    
    var playlist = description + '\n' + 'From Channel: ' + channel + '\n' + '🔗 ' + link + 
        '\n➖➖ ESTIMATED COSTS TO DATE FOR THIS MONTH IN US $' + costs + 
        ' ➖➖➖  \n➖  DATA USAGE LIMIT: ' + Math.ceil(settings.maxdata/1048576) + 
        'MB ➖ DATA USED: ' + Math.ceil(settings.dataused/1048576) + 
        ' MB ➖ DATA REMAINING: ' + 
        Math.ceil((settings.maxdata - settings.dataused)/1048576) + 
        ' MB\n➖ AutoPlay is ' + settings.autoplay + 
        ' ➖ Shuffle Mode is ' + settings.shuffle + 
        ' ➖ Loop mode is ' + settings.loop + ' ➖\n' +
        '➖➖➖➖➖➖➖➖➖➖➖➖➖➖➖➖➖➖➖➖➖➖\n...........................TRACK LISTING...........................\n➖➖➖➖➖➖➖➖➖➖➖➖➖➖➖➖➖➖➖➖➖➖\n' + tracklist

  return playlist;

};

alextube.prototype.help = function(currentresult) {
    
    var cardtext = '1. Request a particular video: "Alexa, ask tamilAssembly to play ACA Avadi"\n' +
'2. Request an auto generated playlist of 25 results: - "Alexa ask tamilAssembly to play SOME Potter\'s Ministries audio."\n' +
'3. Request a particular track from the playlist: "Alexa, ask tamilAssembly to play Track 10"\n' +
'4. Skip to the next/previous track:- "Alexa, next/ previous track"\n' +
'5. Pause:- "Alexa pause" or "Alexa stop"\n' +
'6. Resume playback:- "Alexa resume" ' +
'7. Find out what is playing by asking "Alexa ask tamilAssembly whats playing - this will also tell you your data usage"\n' +
'8. Loop the current playlist:- "Alexa Loop On/Off"\n' +
'9. Shuffle mode On/Off:- "Alexa shuffle On/Off"\n' +
'10. Start the track currently playing fromt he beginning:- "Alexa Start Over"\n'
'11. Increae the data limit (this will allow the skill to incur data charges from AWS):- "Alexa, ask tamilAssembly to increase the data limit"\n' +
'12. Reset the data limit to default of 1000MB:- "Alexa, ask tamilAssembly to reset the data limit"'
    
    var cardTitle = 'TamilAssembly Skill Commands'
    
    this.speakWithCard ('Please see the Alexa app for a list of commands that can be used with this skill', cardTitle, cardtext)

}

alextube.prototype.upload = function(audioName, enqueue, offset) {
    
    var uploadfuntion = this;
    
        const dropboxUploadStream = dropbox({
                resource: 'files/upload',
                parameters: {
                    path: '/youtube-skill/'+ audioName,
                    mode: 'overwrite',
                    mute: true
                }
            }, (err, result) => {
                if (err){
                    console.log('There was an error')
                    console.log(err)
                } else if (result){
                    console.log(result)
                    dropbox({
                        resource: 'files/get_temporary_link',
                        parameters: {
                            'path': '/youtube-skill/'+ audioName
                        }
                    }, (err, result) => {
                        if (err){
                            console.log('There was an error')
                    console.log(err)
                        } else if (result){
                            console.log('Here is the temp link')
                            console.log(result.link)
                            var streamURL = result.link
                            
                            fs.unlink(mainOutput, err => {
                              if(err) console.error(err);
                              
                            });
                            if (!enqueue){
                                console.log('normal play')
                                var token = uploadfuntion.createToken();
                                settings.currenttoken = token
                                settings.enqueue = false
                                settings.currentURL = streamURL;
                                
                            
                            uploadfuntion.saveSettings(function(err, result)  {
                                    if (err) {
                                        console.log('There was an error saving settings to dropbox', err)

                                        uploadfuntion.speak('There was an error saving settings to dropbox')
                                    } else {
                                        
                                         
                                        uploadfuntion.play(streamURL, offset, token);
                                    }
                                });      
                                
                            } else {
                                console.log('enque play')
                                var previoustoken = settings.currenttoken
                                
                                var token = uploadfuntion.createToken();
                                settings.currenttoken = token
                                settings.enqueue = true
                                
                                settings.previousURL = settings.currentURL
                                settings.currentURL = streamURL;
                                
                                
                            
                            uploadfuntion.saveSettings(function(err, result)  {
                                    if (err) {
                                        console.log('There was an error saving settings to dropbox', err)

                                        uploadfuntion.speak('There was an error saving settings to dropbox')
                                    } else {
                                        
                                         
                                        uploadfuntion.enqueue(streamURL, 0, token, previoustoken);
                                    }
                                });

                            }

                        }
                        
                    });
                }
            });
    var readmp4 = fs.createReadStream(mainOutput).pipe(dropboxUploadStream);

}


let relevantEvents = new Array();
let output;
alextube.prototype.searchCalendar = function() {

    // Declare variables
    let eventList = new Array();
    const slotValue = this.event.request.intent.slots.date.value;
    console.log("Slot value"+ slotValue);
    if (slotValue != undefined) {
        let parent = this;

        // Using the iCal library I pass the URL of where we want to get the data from.
        ical.fromURL(URL, {}, function (error, data) {
            // Loop through all iCal data found
            for (let k in data) {
                if (data.hasOwnProperty(k)) {
                    let ev = data[k];
                    // Pick out the data relevant to us and create an object to hold it.
                    let eventData = {
                        summary: removeTags(ev.summary),
                        location: removeTags(ev.location),
                        description: removeTags(ev.description),
                        start: ev.start
                    };
                    // add the newly created object to an array for use later.
                    eventList.push(eventData);
                }
            }
            // Check we have data
            if (eventList.length > 0) {
                console.log("Event Dump"+ JSON.stringify(eventList));
                // Read slot data and parse out a usable date
                const eventDate = getDateFromSlot(slotValue);
                // Check we have both a start and end date
                if (eventDate.startDate && eventDate.endDate) {
                    // initiate a new array, and this time fill it with events that fit between the two dates
                    relevantEvents = getEventsBeweenDates(eventDate.startDate, eventDate.endDate, eventList);

                    if (relevantEvents.length > 0) {
                        // change state to description
                       // parent.handler.state = states.DESCRIPTION;

                        // Create output for both Alexa and the content card
                        let cardContent = "";
                        output = oneEventMessage;
                        if (relevantEvents.length > 1) {
                            output = utils.format(multipleEventMessage, relevantEvents.length);
                        }

                        output += scheduledEventMessage;

                        if (relevantEvents.length > 1) {
                            output += utils.format(firstThreeMessage, relevantEvents.length > 3 ? 3 : relevantEvents.length);
                        }

                        if (relevantEvents[0] != null) {
                            let date = new Date(relevantEvents[0].start);
                            output += utils.format(eventSummary, "First", removeTags(relevantEvents[0].summary), relevantEvents[0].location, date.toDateString() + ".");
                        }
                        if (relevantEvents[1]) {
                            let date = new Date(relevantEvents[1].start);
                            output += utils.format(eventSummary, "Second", removeTags(relevantEvents[1].summary), relevantEvents[1].location, date.toDateString() + ".");
                        }
                        if (relevantEvents[2]) {
                            let date = new Date(relevantEvents[2].start);
                            output += utils.format(eventSummary, "Third", removeTags(relevantEvents[2].summary), relevantEvents[2].location, date.toDateString() + ".");
                        }

                        for (let i = 0; i < relevantEvents.length; i++) {
                            let date = new Date(relevantEvents[i].start);
                            cardContent += utils.format(cardContentSummary, removeTags(relevantEvents[i].summary), removeTags(relevantEvents[i].location), getEventTime(relevantEvents[i].start) + ".");
                        }

                        output += eventNumberMoreInfoText;
                        parent.speakWithCard(cardContent, cardTitle, cardContent);
                        parent.speak(output, true);
                    } else {
                        output = NoDataMessage;
                        parent.speak(output);
                    }
                }
                else {
                    output = NoDataMessage;
                    parent.speak(output);
                }
            } else {
                output = NoDataMessage;
                parent.speak(output);
            }
        });
    }
    else {
        parent.speak("I'm sorry.  What day did you want me to look for events?", true);
    }

}

// Remove HTML tags from string
function removeTags(str) {
    if (str) {
        return str.replace(/<(?:.|\n)*?>/gm, '');
    }
}

// Given an AMAZON.DATE slot value parse out to usable JavaScript Date object
// Utterances that map to the weekend for a specific week (such as �this weekend�) convert to a date indicating the week number and weekend: 2015-W49-WE.
// Utterances that map to a month, but not a specific day (such as �next month�, or �December�) convert to a date with just the year and month: 2015-12.
// Utterances that map to a year (such as �next year�) convert to a date containing just the year: 2016.
// Utterances that map to a decade convert to a date indicating the decade: 201X.
// Utterances that map to a season (such as �next winter�) convert to a date with the year and a season indicator: winter: WI, spring: SP, summer: SU, fall: FA)
function getDateFromSlot(rawDate) {
    // try to parse data
    let date = new Date(Date.parse(rawDate));
    // create an empty object to use later
    let eventDate = {

    };
    console.log("DATE "+ rawDate);
    // if could not parse data must be one of the other formats
    if (isNaN(date)) {
        // to find out what type of date this is, we can split it and count how many parts we have see comments above.
        const res = rawDate.split("-");
        // if we have 2 bits that include a 'W' week number
        if (res.length === 2 && res[1].indexOf('W') > -1) {
            let dates = getWeekData(res);
            console.log("dates"+ dates);
            eventDate["startDate"] = new Date(dates.startDate);
            eventDate["endDate"] = new Date(dates.endDate);
            // if we have 3 bits, we could either have a valid date (which would have parsed already) or a weekend
        } else if (res.length === 3) {
            let dates = getWeekendData(res);
            console.log("dates"+ dates);
            eventDate["startDate"] = new Date(dates.startDate);
            eventDate["endDate"] = new Date(dates.endDate);
            // anything else would be out of range for this skill
        } else {
            eventDate["error"] = dateOutOfRange;
        }
        // original slot value was parsed correctly
    } else {
        eventDate["startDate"] = new Date(date).setUTCHours(0, 0, 0, 0);
        eventDate["endDate"] = new Date(date).setUTCHours(24, 0, 0, 0);
    }
    console.log("Event Date"+ JSON.stringify(eventDate));
    return eventDate;
}

// Given a week number return the dates for both weekend days
function getWeekendData(res) {
    if (res.length === 3) {
        const saturdayIndex = 5;
        const sundayIndex = 6;
        const weekNumber = res[1].substring(1);

        const weekStart = w2date(res[0], weekNumber, saturdayIndex);
        const weekEnd = w2date(res[0], weekNumber, sundayIndex);

        return {
            startDate: weekStart,
            endDate: weekEnd,
        };
    }
}

// Given a week number return the dates for both the start date and the end date
function getWeekData(res) {
    if (res.length === 2) {

        const mondayIndex = 0;
        const sundayIndex = 6;

        const weekNumber = res[1].substring(1);

        const weekStart = w2date(res[0], weekNumber, mondayIndex);
        const weekEnd = w2date(res[0], weekNumber, sundayIndex);

        return {
            startDate: weekStart,
            endDate: weekEnd,
        };
    }
}

// Used to work out the dates given week numbers
const w2date = function (year, wn, dayNb) {
    const day = 86400000;

    const j10 = new Date(year, 0, 10, 12, 0, 0),
        j4 = new Date(year, 0, 4, 12, 0, 0),
        mon1 = j4.getTime() - j10.getDay() * day;
    return new Date(mon1 + ((wn - 1) * 7 + dayNb) * day);
};

// Loops though the events from the iCal data, and checks which ones are between our start data and out end date
function getEventsBeweenDates(startDate, endDate, eventList) {

    const start = new Date(startDate);
    const end = new Date(endDate);

    let data = new Array();

    for (let i = 0; i < eventList.length; i++) {
        if (start <= eventList[i].start && end >= eventList[i].start) {
            data.push(eventList[i]);
        }
    }

    console.log("FOUND " + data.length + " events between those times");
    return data;
}

//Find AM or PM of the event time
function getEventTime(startDate){
    var hours = startDate.getHours();
    var min = startDate.getMinutes() == 0 ? "00": startDate.getMinutes();
    var startTime = hours +':'+ min;
    var time = (hours+24-2)%24;
    var mid='AM';
    if(time==0){ //At 00 hours we need to show 12 am
        time=12;
    }
    else if(time>12)
    {
        time=time%12;
        mid='PM';
    }
 return startTime + " "+ mid;
}