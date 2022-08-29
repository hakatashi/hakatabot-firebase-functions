

import {https, logger} from 'firebase-functions';
import {google} from 'googleapis';
import {BILLBOARD_HOT100_ID, HAKATASHI_EMAIL} from '../const';
import {GoogleTokens} from '../firestore';

import {oauth2Client} from '../google';

// initialize the Youtube API library
const youtube = google.youtube('v3');

export const latestBillboardJapanHot100 = https.onRequest(async (request, response) => {
	const hakatashiTokensData = await GoogleTokens.doc(HAKATASHI_EMAIL).get();

	if (!hakatashiTokensData.exists) {
		logger.error('hakatashi token not found');
		return;
	}

	const hakatashiTokens = hakatashiTokensData.data();
	oauth2Client.setCredentials(hakatashiTokens!);

	const data = await youtube.channelSections.list({
		id: [BILLBOARD_HOT100_ID],
		auth: oauth2Client,
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
