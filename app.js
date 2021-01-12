const ENJOY_BRIDGE_NS = 'urn:x-cast:enjoy.bridge';

let castContext;

const onCastLoad = async (details) => {
    console.log('Intercepting LOAD request', JSON.stringify(details));
    const { provider, videoId } = details.media.metadata;
    let manifest;
    if (provider === 'DISNEYPLUS') {
        const playlistJson = await getDisneyplusManifest(videoId);
        manifest = playlistJson.fixed_manifest;
        console.log(manifest);
        // videoPlayer.configure({
        //     drm: {
        //         servers: {
        //             'com.widevine.alpha': 'drm:https://global.edge.bamgrid.com/widevine/v1/obtain-license',
        //         },
        //     },
        // });
    } else {
        console.error('Unrecognized provider', provider);
    }

    const bb = new Blob([manifest], { type: 'text/plain' });
    const objectURL = URL.createObjectURL(bb);
    // try {
    //     await videoPlayer.load(objectURL, null, 'application/x-mpegURL');
    // } catch (error) {
    //     console.log(error);
    // }

    // Attach player to the window to make it easy to access in the JS console.
    // window.player = videoPlayer;
};

const initializeApp = () => {
    console.log('app initialized');
    // setup the cast receiver to listen for the cast session start
    // if (!castContext) {
    castContext = window.cast.framework.CastReceiverContext.getInstance();
    const playerManager = castContext.getPlayerManager();
    // wait 10 seconds so we can get into the devtools
    playerManager.setMessageInterceptor(cast.framework.messages.MessageType.LOAD, details => setTimeout(() => onCastLoad(details), 1000));
    // playerManager.setMessageInterceptor(cast.framework.messages.MessageType.LOAD, onCastLoad);

    const options = window.cast.framework.CastReceiverOptions() || {};
    options.customNamespaces = {
        [ENJOY_BRIDGE_NS]: window.cast.framework.system.MessageType.JSON,
    };
    castContext.start(options);

    castContext.addCustomMessageListener(ENJOY_BRIDGE_NS, (message) => {
        const { data } = message.data;
        console.log('got it', data);
        // if (shaka && !videoPlayer) {
        //     console.log('shaka.Player.version', shaka.Player.version);
        //     shaka.polyfill.installAll();
        //     shaka.net.NetworkingEngine.registerScheme('drm', EnjoyDrmScheme);
        //     shaka.net.NetworkingEngine.registerScheme('blob', shaka.net.HttpXHRPlugin.parse);
        //     console.log(videoEl);
        //     videoPlayer = new shaka.Player(videoEl);
        //     // videoPlayer.getNetworkingEngine().registerRequestFilter(drmLicenseRequest);
        //     videoPlayer.getNetworkingEngine().registerResponseFilter(drmLicenseResponse);
        //     videoPlayer.addEventListener('error', onErrorEvent);
        // }

        // if (data.action === 'START') {
        //     initPlayer();
        // } else if (data.action === 'LICENSE') {
        // set the license key
        // const customEvent = new CustomEvent('senderResponse', { detail: { payload: data.payload } });
        // window.dispatchEvent(customEvent);
        // }
    });
};
