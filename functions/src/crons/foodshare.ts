import {IncomingWebhook} from '@slack/webhook';
import axios from 'axios';
import {logger, pubsub, config as getConfig} from 'firebase-functions';
import {HAKATASHI_EMAIL} from '../const';
import {GoogleTokens, GoogleFoodPhotos} from '../firestore';
import {oauth2Client} from '../google';

const config = getConfig();

const cookingWebhook = new IncomingWebhook(config.slack.webhooks.cooking);

export const foodshareCronJob = pubsub.schedule('every 5 minutes').onRun(async () => {
	const hakatashiTokensData = await GoogleTokens.doc(HAKATASHI_EMAIL).get();

	if (!hakatashiTokensData.exists) {
		logger.error('hakatashi token not found');
		return;
	}

	const hakatashiTokens = hakatashiTokensData.data();
	oauth2Client.setCredentials(hakatashiTokens!);

	const accessToken = await oauth2Client.getAccessToken();

	const res = await axios.post('https://photoslibrary.googleapis.com/v1/mediaItems:search', {
		filters: {
			contentFilter: {
				includedContentCategories: ['FOOD'],
			},
		},
	}, {
		headers: {
			Authorization: `Bearer ${accessToken.token}`,
			'Content-Type': 'application/json',
		},
	});

	for (const item of res.data.mediaItems) {
		const photoEntry = GoogleFoodPhotos.doc(item.id);
		if ((await photoEntry.get()).exists) {
			continue;
		}

		photoEntry.set(item);

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
	}
});
