import {pubsub} from 'firebase-functions';

// const config = getConfig();

export const foodshareCronJob = pubsub.schedule('every 5 minutes').onRun((context) => {
	console.log('This will be run every 5 minutes!');
	return null;
});
