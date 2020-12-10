import {IncomingWebhook} from '@slack/webhook';
import axios from 'axios';
import {pubsub, config as getConfig} from 'firebase-functions';

const config = getConfig();

const cookingWebhook = new IncomingWebhook(config.slack.webhooks.cooking);

const tokens = {} as any;

export const foodshareCronJob = pubsub.schedule('every 5 minutes').onRun(async () => {
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

	// eslint-disable-next-line prefer-destructuring
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

	console.log('This will be run every 5 minutes!');
	return null;
});
