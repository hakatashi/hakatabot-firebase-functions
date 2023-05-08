import {PubSub, Message} from '@google-cloud/pubsub';
import {logger, pubsub} from 'firebase-functions';

const pubsubClient = new PubSub();

export const rinnaPingCronJob = pubsub.schedule('every 1 minute').onRun(async () => {
	const now = Date.now();

	const topicId = `rinna-ping-${now}`;
	const subscriptionId = `rinna-ping-subscription-${now}`;

	logger.info(`Creating one-time subscription (topicId = ${topicId}, subscriptionId = ${subscriptionId})`);

	await pubsubClient
		.createTopic(topicId);

	logger.info(`Created topic ${topicId}`);

	await pubsubClient
		.topic(topicId)
		.createSubscription(subscriptionId, {
			enableExactlyOnceDelivery: true,
		});

	logger.info(`Created subscription ${subscriptionId}`);

	const topic = pubsubClient.topic(topicId);
	const subscription = pubsubClient.subscription(subscriptionId);

	try {
		await new Promise<void>((resolve, reject) => {
			subscription.once('message', (message: Message) => {
				logger.info(`Received message ${message.id}`);
				logger.info(message);
				message.ackWithResponse().then(
					() => resolve(),
					(error) => reject(error),
				);
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
		});
	} catch (error) {
		logger.error(error);
	} finally {
		logger.info(`Deleting subscription ${subscriptionId}`);
		await subscription.delete();
		logger.info(`Deleted subscription ${subscriptionId}`);

		logger.info(`Deleting topic ${topicId}`);
		await topic.delete();
		logger.info(`Deleted topic ${topicId}`);
	}
});
