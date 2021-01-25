const providerFetch = async ({ url, request, reqType, resType }) => {
    const senderFetch = new Promise((resolve) => {
        // setup a call back from windows messaging
        const callback = (data) => {
            window.removeEventListener('senderResponse', callback);
            console.log('Got response on the receiver');
            console.log(data);
            const { payload } = data.detail;
            console.log(payload);
            try {
                resolve(payload);
                // if (!['text', 'arraybuffer'].includes(resType)) {
                //     resolve(JSON.parse(decodedPayload));
                // } else {
                //     resolve(decodedPayload);
                // }
            } catch (err) {
                console.error('senderFetch callback Error:', err);
                resolve(err);
            }
        };
        window.addEventListener('senderResponse', callback);

        // send the native app the request we need them to process on the netflix domain
        const context = window.cast.framework.CastReceiverContext.getInstance();
        context.sendCustomMessage(ENJOY_BRIDGE_NS, undefined, {
            type: 'proxy',
            ProviderRequest: {
                provider: 'disneyplus',
                resType,
                reqType,
                url,
                request,
            },
        });
    });

    const resJson = await senderFetch;

    return resJson;
};

const XMLHttpRequestOpen = XMLHttpRequest.prototype.open;
const XMLHttpRequestSend = XMLHttpRequest.prototype.send;

// eslint-disable-next-line func-names
XMLHttpRequest.prototype.open = function (...args) {
    // record the url for the send intercept
    this.url = args[0] === 'GET' ? args[1] : '';
    return XMLHttpRequestOpen.call(this, ...args);
};

// eslint-disable-next-line func-names
XMLHttpRequest.prototype.send = function (...args) {
    // If this is a disney playlist hls manifest, then redirect through the native app
    if (this.url.indexOf('.m3u8') > -1) {
        console.log('intercepting xhr open', this);
        providerFetch({
            url: this.url,
            request: { method: 'GET', mode: 'cors' },
            resType: 'text',
        }).then((res) => {
            Object.defineProperty(this, 'readyState', { value: 4, writable: false });
            Object.defineProperty(this, 'status', { value: 200, writable: false });
            Object.defineProperty(this, 'responseType', { value: 'text', writable: false });
            // switch relative paths to absolute within the manifest
            const absoluteRes = res
                .replace(
                    /(URI=")([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/gm,
                    `$1${this.url.substring(0, this.url.lastIndexOf('/'))}/$2`,
                )
                .replace(
                    /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/gm,
                    `${this.url.substring(0, this.url.lastIndexOf('/'))}/$1`,
                );
                // .replace(
                //     /^#EXT-X-KEY:METHOD=SAMPLE-AES-CTR,KEYFORMAT="PRMNAGRA".*\n?/m,
                //     '',
                // )
                // .replace(
                //     /^#EXT-X-KEY:METHOD=SAMPLE-AES-CTR,KEYFORMAT="com.microsoft.playready".*\n?/m,
                //     '',
                // );
            console.log(absoluteRes);
            // Update the value of the response
            Object.defineProperty(this, 'response', { value: absoluteRes, writable: false });
            Object.defineProperty(this, 'responseText', { value: absoluteRes, writable: false });
            if (this.onreadystatechange) this.onreadystatechange({ currentTarget: this });
        });
        return null;
    }
    console.log('not intercepting xhr open', this.url);
    return XMLHttpRequestSend.call(this, ...args);
};

const uuidv4 = () => 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0; const
        v = c === 'x' ? r : ((r & 0x3) | 0x8);
    return v.toString(16);
});

const getDisneyplusManifest = async (videoId) => {
    try {
        const getPlaylist = async () => {
            // eslint-disable-next-line max-len
            const metadataUrl = `https://search-api-disney.svcs.dssott.com/svc/search/v2/graphql/persisted/query/core/DmcVideos?variables={"appLanguage":"en","preferredLanguage":"en","contentId":"${videoId}","contentTransactionId":"${uuidv4()}"}`;
            console.log('loading DmcVideos object');
            const metadataResponse = await providerFetch({
                url: metadataUrl,
                request: {
                    method: 'GET',
                    headers: {
                        authorization: 'Bearer {accessToken}', // access token will be set on android webview side
                    },
                },
                resType: 'json',
            });

            const metadataObj = metadataResponse.json ? await metadataResponse.json() : metadataResponse;
            const { mediaId } = metadataObj.data.DmcVideos.videos[0];

            const playlistUrl = `https://global.edge.bamgrid.com/media/${mediaId}/scenarios/restricted-drm-ctr-sw`;
            console.log('loading playlist object');
            const playlistResponse = await providerFetch({
                url: playlistUrl,
                request: {
                    method: 'GET',
                    headers: {
                        accept: 'application/vnd.media-service+json; version=4',
                        authorization: '{accessToken}', // access token will be set on android webview side
                    },
                },
                resType: 'json',
            });
            console.log('got playlist object');
            return playlistResponse.json ? playlistResponse.json() : playlistResponse;
        };

        const playlistJson = await getPlaylist();
        console.log('playListJson retrieved');
        // download and "fix" the manifest, inject it into the playlist
        const path = playlistJson.stream.complete;
        console.log('loading hls manifest', path);
        const m3u8Response = await providerFetch({
            url: path,
            request: { method: 'GET', mode: 'cors' },
            resType: 'text',
        });
        const rawManifest = m3u8Response.text ? await m3u8Response.text() : m3u8Response;
        console.log('got hls manifest');
        // make all urls fully qualified instead of relative
        let manifest = rawManifest
            .replace(/URI="r\//gm, `URI="${path.substring(0, path.lastIndexOf('/'))}/r/`)
            .replace(/^r\//gm, `${path.substring(0, path.lastIndexOf('/'))}/r/`);
        console.log(manifest);

        // If we are on certain fire sticks, then we will need to remove the eac-3 codec since
        // the exoplayer won't transcode it and passes it through to the device directly.
        // That prevents us from being able to control the volume so we just don't let the eac-3
        // codec through. Another option for another day may be to use an ffmpeg exoplayer extension
        // to transcode the eac-3 to eac.
        // Note that we "know" that AFTA (cube) and AFTN (square) supports eac-3 transcoding
        // And we "know" that AFTT (Gen2 stick) doesn't support it. These others are guesses.

        // Also it was discovered that the eac-3 prevents playback rate control from several devices. So now we just always remove it.
        console.log('modifying manifest to remove eac-3 codec');
        // const fixedManifest = [];
        // manifest.split('\n').forEach((line) => {
        //     if (line.indexOf(',GROUP-ID="eac-3",') === -1) {
        //         fixedManifest.push(`${line}\n`);
        //     }
        // });
        // manifest = fixedManifest.join('');

        playlistJson.fixed_manifest = manifest;
        console.log(playlistJson);

        return playlistJson;
    } catch (err) {
        console.error('getDisneyplusManifest error', err);
    }
    return null;
};

const getDisneyplusLicense = async (challenge) => {
    try {
        // let accessToken = await getAccessToken();
        // const byteArray = Uint8Array.from(atob(decodeURIComponent(challenge)), c => c.charCodeAt(0));
        const url = 'https://global.edge.bamgrid.com/widevine/v1/obtain-license';

        console.log('Request license from', url, 'with', challenge);

        const res = await providerFetch({
            url,
            request: {
                method: 'POST',
                mode: 'cors',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: 'Bearer {accessToken}',
                },
                body: encodeURIComponent(challenge),
            },
            reqType: 'arraybuffer',
            resType: 'arraybuffer',
        });
        return res;
    } catch (err) {
        console.error('getDisneyplusLicense error', err);
    }
    return {};
};
