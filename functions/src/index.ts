import {IncomingWebhook} from '@slack/webhook';
import axios from 'axios';
import {https, logger, config as getConfig} from 'firebase-functions';
import {google} from 'googleapis';

export * from './slack';
export * from './crons';

const config = getConfig();

const cookingWebhook = new IncomingWebhook(config.slack.webhooks.cooking);

const oauth2Client = new google.auth.OAuth2(
	config.google.client_id,
	config.google.client_secret,
	'https://us-central1-hakatabot-firebase-functions.cloudfunctions.net/googleApiOauthCallback',
);

export const authenticateGoogleApi = https.onRequest((request, response) => {
	const url = oauth2Client.generateAuthUrl({
		access_type: 'offline',
		scope: [
			'https://www.googleapis.com/auth/photoslibrary',
			'https://www.googleapis.com/auth/photoslibrary.readonly',
			'https://www.googleapis.com/auth/photoslibrary.readonly.appcreateddata',
		],
	});
	logger.info(url);
	response.redirect(url);
});

export const googleApiOauthCallback = https.onRequest(async (request, response) => {
	const code = request.query?.code;
	if (!code || typeof code !== 'string') {
		response.sendStatus(400).end();
		return;
	}
	const {tokens} = await oauth2Client.getToken(code);
	oauth2Client.setCredentials(tokens);

	const res = await axios.post('https://photoslibrary.googleapis.com/v1/mediaItems:search', {
		filters: {
			contentFilter: {
				includedContentCategories: [
					'FOOD',
				],
			},
		},
	}, {
		headers: {
			Authorization: `Bearer ${tokens.access_token}`,
			'Content-Type': 'application/json',
		},
	});

	const item = res.data.mediaItems[4];
	const url = `${item.baseUrl}=w1264-h948`;
	await cookingWebhook.send({
		text: `料理した <${url}|写真>`,
		unfurl_links: false,
		unfurl_media: false,
		blocks: [
			{
				type: 'section',
				text: {
					type: 'plain_text',
					text: '料理した',
					emoji: true,
				},
			},
			{
				type: 'image',
				block_id: 'image',
				image_url: url,
				alt_text: '料理',
			},
		],
	});

	response.send('hoge');
});
