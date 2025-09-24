import {info as logInfo} from 'firebase-functions/logger';
import {onRequest} from 'firebase-functions/v2/https';
import {google} from 'googleapis';
import {BILLBOARD_HOT100_ID} from '../const.js';
import {getGoogleAuth} from '../google.js';

// initialize the Youtube API library
const youtube = google.youtube('v3');

export const latestBillboardJapanHot100 = onRequest({memory: '512MiB'}, async (request, response) => {
	const auth = await getGoogleAuth();
	const data = await youtube.channelSections.list({
		id: [BILLBOARD_HOT100_ID],
		auth,
		part: ['contentDetails', 'id', 'snippet'],
	});
	const playlists: string[] = data?.data?.items?.[0]?.contentDetails?.playlists ?? [];

	logInfo(`Retrieved ${playlists.length} playlists`);

	if (playlists.length === 0) {
		response.status(500);
		response.send('Internal Server Error');
		return;
	}

	response.redirect(`https://www.youtube.com/playlist?list=${playlists[0]}`);
});
