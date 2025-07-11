import type {DocumentReference, CollectionReference} from '@google-cloud/firestore';
import firebase from 'firebase-admin';

firebase.initializeApp();

export interface ItQuizProgressStat {
	date: string,
	done: number,
	ideas: number,
}

export interface ItQuizVideoEngagement {
	volume: string,
	engagements: {
		impressions: number,
		likes: number,
		comments: number,
	},
}

export interface ItQuizVideoEngagementStats {
	date: string,
	tiktok: ItQuizVideoEngagement[],
	youtube: ItQuizVideoEngagement[],
	instagram: ItQuizVideoEngagement[],
}

export const db = firebase.firestore();
export const GoogleTokens = db.collection('google-tokens');
export const GoogleFoodPhotos = db.collection('google-food-photos');
export const FitbitTokens = db.collection('fitbit-tokens');
export const TikTokTokens = db.collection('tiktok-tokens');
export const FitbitActivities = db.collection('fitbit-activities');
export const FitbitSleeps = db.collection('fitbit-sleeps');
export const AnimeWatchRecords = db.collection('anime-watch-records');
export const ItQuizProgressStats = db.collection('it-quiz-progress-stats') as CollectionReference<ItQuizProgressStat>;
export const States = db.collection('states');
export const SteamFriends = db.collection('steam-friends');
export const ItQuizVideoEngagements = db.collection('it-quiz-video-engagements') as CollectionReference<ItQuizVideoEngagementStats>;

export class State {
	doc: DocumentReference;

	constructor(name: string) {
		this.doc = States.doc(name);
	}

	set(value: Record<string, any>) {
		return this.doc.set(value, {merge: true});
	}

	async get<T>(name: string): Promise<T | undefined>;

	async get<T>(name: string, defaultValue: T): Promise<T>;

	async get<T>(name: string, defaultValue?: T): Promise<T | undefined> {
		const data = await this.doc.get();
		if (data.exists) {
			return data.get(name) ?? defaultValue;
		}
		if (defaultValue !== undefined) {
			return defaultValue;
		}
		return undefined;
	}
}
