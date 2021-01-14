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

const initializeApp = () => {
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
        window.videoPlayer = new shaka.Player(video);
        window.videoPlayer.getNetworkingEngine().registerResponseFilter(drmLicenseResponse);
        window.videoPlayer.addEventListener('error', onErrorEvent);
    }

    console.log('app initialized');
};