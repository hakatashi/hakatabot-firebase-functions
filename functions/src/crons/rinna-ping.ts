import {PubSub, Message} from '@google-cloud/pubsub';
import axios from 'axios';
import {logger, pubsub, config as getConfig} from 'firebase-functions';

const config = getConfig();

const pubsubClient = new PubSub();

interface PongMessage {
	type: 'rinna-pong',
	mode: string,
}

export const rinnaPingCronJob = pubsub.schedule('every 1 minutes').onRun(async () => {
	const now = Date.now();

	const topicId = `rinna-ping-${now}`;
	const subscriptionId = `rinna-ping-subscription-${now}`;

	logger.info(`Creating one-time subscription (topicId = ${topicId}, subscriptionId = ${subscriptionId})`);

	const [topic] = await pubsubClient.createTopic(topicId);

	logger.info(`Created topic ${topicId}`);

	const [subscription] = await pubsubClient
		.topic(topicId)
		.createSubscription(subscriptionId, {
			enableExactlyOnceDelivery: true,
		});

	logger.info(`Created subscription ${subscriptionId}`);

	// eslint-disable-next-line no-undef
	let timeoutId: NodeJS.Timeout | null = null;

	try {
		const pongPromise = new Promise<PongMessage>((resolve, reject) => {
			subscription.once('message', (message: Message) => {
				logger.info(`Received message ${message.id}`);
				logger.info(message);

				const data = JSON.parse(message.data.toString());
				message.ackWithResponse().then(
					() => resolve(data),
					(error) => reject(error),
				);
			});
		});

		const timeoutPromise = new Promise<never>((_resolve, reject) => {
			timeoutId = setTimeout(() => {
				logger.error('Timed out');
				reject(new Error('Timeout'));
			}, 1000 * 30);
		});

		logger.info('Publishing ping message to topic hakatabot');

		pubsubClient
			.topic('hakatabot')
			.publishMessage({
				data: Buffer.from(JSON.stringify({
					type: 'rinna-ping',
					topicId,
				})),
			});

		logger.info('Published ping message to topic hakatabot');

		const pongMessage = await Promise.race([pongPromise, timeoutPromise]);
		const status = pongMessage.mode === 'GPU' ? 'operational' : 'degraded_performance';

		logger.info(`Posting status (mode = ${pongMessage.mode}, status = ${status})`);
		await axios.patch(
			`https://api.statuspage.io/v1/pages/${config.statuspage.page_id}/components/${config.statuspage.component_id}`,
			{
				component: {status},
			},
			{
				headers: {
					Authorization: `OAuth ${config.statuspage.token}`,
				},
			},
		);
	} catch (error) {
		logger.error(error);
	} finally {
		if (timeoutId) {
			clearTimeout(timeoutId);
		}
		subscription.removeAllListeners('message');

		logger.info(`Deleting subscription ${subscriptionId}`);
		await subscription.delete();
		logger.info(`Deleted subscription ${subscriptionId}`);

		logger.info(`Deleting topic ${topicId}`);
		await topic.delete();
		logger.info(`Deleted topic ${topicId}`);
	}
});
