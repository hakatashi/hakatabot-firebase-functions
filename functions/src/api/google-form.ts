import {PubSub} from '@google-cloud/pubsub';
import {https, logger} from 'firebase-functions';

export const googleFormLlmBenchmarkSubmission = https.onRequest(async (request, response) => {
	const data = JSON.parse(request.body);

	logger.info('googleFormLlmBenchmarkSubmission started');

	const pubsubClient = new PubSub();

	await pubsubClient.topic('hakatabot').publishMessage({
		data: Buffer.from(JSON.stringify({
			type: 'llm-benchmark-submission',
			data,
		})),
	});

	response.status(200).send('OK');
});
