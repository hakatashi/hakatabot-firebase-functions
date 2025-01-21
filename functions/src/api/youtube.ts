import {https, logger} from 'firebase-functions';
import {google} from 'googleapis';
import {BILLBOARD_HOT100_ID} from '../const.js';
import {getGoogleAuth} from '../google.js';

// initialize the Youtube API library
const youtube = google.youtube('v3');

export const latestBillboardJapanHot100 = https.onRequest(async (request, response) => {
	const auth = await getGoogleAuth();
	const data = await youtube.channelSections.list({
		id: [BILLBOARD_HOT100_ID],
		auth,
		part: ['contentDetails', 'id', 'snippet'],
	});
	const playlists: string[] = data?.data?.items?.[0]?.contentDetails?.playlists ?? [];

	logger.info(`Retrieved ${playlists.length} playlists`);

	if (playlists.length === 0) {
		response.status(500);
		response.send('Internal Server Error');
		return;
	}

	response.redirect(`https://www.youtube.com/playlist?list=${playlists[0]}`);
});
