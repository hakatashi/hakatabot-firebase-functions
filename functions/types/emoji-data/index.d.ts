declare module 'emoji-data' {
	interface Emoji {
		name: string,
		unified: string,
		variations: string[],
		docomo: string,
		au: string,
		softbank: string,
		google: string,
		short_name: string,
		short_names: string[],
		text: string,
		apple_img: boolean,
		hangouts_img: boolean,
		twitter_img: boolean,
	}

	export function all(): Emoji[];
}
