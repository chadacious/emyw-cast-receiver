const ENJOY_BRIDGE_NS = 'urn:x-cast:enjoy.bridge';

let licenseRequest;

const onCastLoad = async (details) => {
    console.log('Intercepting LOAD request', JSON.stringify(details));
    const { provider, videoId } = details.media.metadata;
    let manifest;
    if (provider === 'DISNEYPLUS') {
        const playlistJson = await getDisneyplusManifest(videoId);
        manifest = playlistJson.fixed_manifest;
        console.log(manifest);
        window.videoPlayer.configure({
            drm: {
                logLicenseExchange: true,
                servers: {
                    'com.widevine.alpha': 'drm:https://global.edge.bamgrid.com/widevine/v1/obtain-license',
                },
            },
        });
    } else {
        console.error('Unrecognized provider', provider);
    }

    const bb = new Blob([manifest], { type: 'text/plain' });
    const objectURL = URL.createObjectURL(bb);
    try {
        await window.videoPlayer.attach(video);
        await window.videoPlayer.load(objectURL, null, 'application/x-mpegURL');
        // window.videoPlayer.getMediaElement().play();
    } catch (error) {
        console.log(error);
    }

};

const EnjoyDrmScheme = async (uri, request, requestType) => {
    console.log('EnjoyDrmScheme', uri, request, requestType);
    licenseRequest = request.body;
    return new shaka.util.AbortableOperation(
        new Promise(() => (null)),
        () => { },
    );
};

const drmLicenseResponse = async (type, response) => {
    if (type === shaka.net.NetworkingEngine.RequestType.LICENSE) {
        const challengeBase64 = btoa(String.fromCharCode(...new Uint8Array(licenseRequest)));
        const license = await getDisneyplusLicense(challengeBase64); // event.target.sessionId);
        const licenseAB = Uint8Array.from(atob(license), c => c.charCodeAt(0));
        response.data = licenseAB.buffer;
    }
};

const onError = (error) => {
    // Log the error.
    console.error('Error code', error.code, 'object', error);
};

const onErrorEvent = (event) => {
    // Extract the shaka.util.Error object from the event.
    onError(event.detail);
};

const initializeApp = async () => {
    // setup the cast receiver to listen for the cast session start
    window.castContext = window.cast.framework.CastReceiverContext.getInstance();
    const playerManager = castContext.getPlayerManager();
    playerManager.setMessageInterceptor(cast.framework.messages.MessageType.LOAD, details => setTimeout(() => onCastLoad(details), 10000));
    // playerManager.setMessageInterceptor(cast.framework.messages.MessageType.LOAD, onCastLoad);

    const options = window.cast.framework.CastReceiverOptions() || {};
    options.customNamespaces = {
        [ENJOY_BRIDGE_NS]: window.cast.framework.system.MessageType.JSON,
    };
    options.skipPlayersLoad = true;
    options.disableIdleTimeout = true;
    window.castContext.start(options);

    window.castContext.addCustomMessageListener(ENJOY_BRIDGE_NS, (message) => {
        console.log('got it', message);
        const { payload, payload1, payload2 } = message.data;
        if (payload) {
            const customEvent = new CustomEvent('senderResponse', { detail: { payload } });
            window.dispatchEvent(customEvent);
        } else if (payload2)  {
            const customEvent = new CustomEvent('senderResponse', { detail: { payload: partialPayload + payload2 } });
            window.dispatchEvent(customEvent);
            partialPayload = null;
        } else {
            partialPayload = payload1;
        }
    });

    if (shaka && !window.videoPlayer) {
        console.log('shaka.Player.version', shaka.Player.version);
        shaka.polyfill.installAll();
        shaka.net.NetworkingEngine.registerScheme('drm', EnjoyDrmScheme);
        shaka.net.NetworkingEngine.registerScheme('blob', shaka.net.HttpXHRPlugin.parse);
        const video = document.getElementById('video');
        console.log(video);
        // video.addEventListener('abort', (res, res2) => console.log('abort', res, res2));
        // video.addEventListener('canplay', (res, res2) => console.log('canplay', res, res2));
        // video.addEventListener('canplaythrough', (res, res2) => console.log('canplaythrough', res, res2));
        // video.addEventListener('durationchange', (res, res2) => console.log('durationchange', res, res2));
        // video.addEventListener('emptied', (res, res2) => console.log('emptied', res, res2));
        // video.addEventListener('ended', (res, res2) => console.log('ended', res, res2));
        // video.addEventListener('error', (res, res2) => console.log('error', res, res2));
        // video.addEventListener('loadeddata', (res, res2) => console.log('loadeddata', res, res2));
        // video.addEventListener('loadedmetadata', (res, res2) => console.log('loadedmetadata', res, res2));
        // video.addEventListener('loadstart', (res, res2) => console.log('loadstart', res, res2));
        // video.addEventListener('pause', (res, res2) => console.log('pause', res, res2));
        // video.addEventListener('play', (res, res2) => console.log('play', res, res2));
        // video.addEventListener('playing', (res, res2) => console.log('playing', res, res2));
        // video.addEventListener('progress', (res, res2) => { console.log('progress', res, res2); console.log(res.loaded, res.total)});
        // video.addEventListener('ratechange', (res, res2) => console.log('ratechange', res, res2));
        // video.addEventListener('seeked', (res, res2) => console.log('seeked', res, res2));
        // video.addEventListener('seeking', (res, res2) => console.log('seeking', res, res2));
        // video.addEventListener('stalled', (res, res2) => console.log('stalled', res, res2));
        // video.addEventListener('suspend', (res, res2) => console.log('suspend', res, res2));
        // video.addEventListener('timeupdate', (res, res2) => console.log('timeupdate', res, res2));
        // video.addEventListener('volumechange', (res, res2) => console.log('volumechange', res, res2));
        // video.addEventListener('waiting', (res, res2) => console.log('waiting', res, res2));



        window.videoPlayer = new shaka.Player();
        shaka.log.setLevel(shaka.log.Level.V2);
        window.videoPlayer.getNetworkingEngine().registerResponseFilter(drmLicenseResponse);
        window.videoPlayer.addEventListener('error', onErrorEvent);
        console.log('initial configuration', window.videoPlayer.getConfiguration());
        // window.videoPlayer.configure('abr.enabled', false);
        window.videoPlayer.configure('streaming.stallEnabled', false);
        // window.videoPlayer.configure('drm.logLicenseExchange', true);
        // window.videoPlayer.configure('streaming.jumpLargeGaps', true);
        // window.videoPlayer.configure('manifest.hls.ignoreTextStreamFailures', true);
        // window.videoPlayer.configure('manifest.hls.useFullSegmentsForStartTime', true);
        window.videoPlayer.configure('streaming.failureCallback', (res) => console.log('failureCallback:', res));
        // window.videoPlayer.configure('streaming.startAtSegmentBoundary', true);
        // window.videoPlayer.configure('streaming.forceTransmuxTS', true);
        // window.videoPlayer.configure('streaming.ignoreTextStreamFailures', true);
        // window.videoPlayer.configure('manifest.disableVideo', true);
        // window.videoPlayer.configure('manifest.disableText', true);
        // window.videoPlayer.configure({
        //     drm: {
        //         servers: {
        //             'com.widevine.alpha': 'drm:https://global.edge.bamgrid.com/widevine/v1/obtain-license',
        //         },
        //     },
        // });
        // console.log('updated configuration', window.videoPlayer.getConfiguration());
        // await window.videoPlayer.attach(video);
    }

    console.log('app initialized');
};