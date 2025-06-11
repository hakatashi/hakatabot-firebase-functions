import {google} from 'googleapis';
import {getGoogleAuth} from '../../google.js';

// Initialize the Youtube API library
const youtube = google.youtube('v3');

export interface YouTubeEngagement {
	impressions: number;
	likes: number;
	comments: number;
}

export const getLatestYouTubeVideoEngagements = async (channelId: string): Promise<[string, YouTubeEngagement][]> => {
	const auth = await getGoogleAuth();

	// First, get the channel's uploads playlist ID
	const channelResponse = await youtube.channels.list({
		auth,
		part: ['contentDetails'],
		id: [channelId],
	});

	if (!channelResponse.data.items || channelResponse.data.items.length === 0) {
		throw new Error(`Channel with ID ${channelId} not found`);
	}

	const uploadsPlaylistId = channelResponse.data.items[0].contentDetails?.relatedPlaylists?.uploads;
	if (!uploadsPlaylistId) {
		throw new Error('Uploads playlist not found for the channel');
	}
	// Get recent videos from the uploads playlist
	const playlistResponse = await youtube.playlistItems.list({
		auth,
		part: ['snippet', 'contentDetails'],
		playlistId: uploadsPlaylistId,
		maxResults: 50,
	});

	if (!playlistResponse.data.items || playlistResponse.data.items.length === 0) {
		throw new Error('No videos found in the channel');
	}

	const videoIds = playlistResponse.data.items.map((item) => item.contentDetails?.videoId).filter(Boolean) as string[];

	const videosResponse = await youtube.videos.list({
		auth,
		part: ['contentDetails', 'snippet', 'statistics'],
		id: videoIds,
	});

	if (!videosResponse.data.items || videosResponse.data.items.length === 0) {
		throw new Error('No video details found');
	}
	// Group videos by publication date and aggregate engagement
	const engagementByDay = new Map<string, YouTubeEngagement>();

	for (const video of videosResponse.data.items) {
		const publishedAt = video.snippet?.publishedAt;
		if (!publishedAt) {
			continue;
		}

		// Extract date in YYYY-MM-DD format
		const date = new Date(publishedAt).toISOString().split('T')[0];

		const impressions = Number.parseInt(video.statistics?.viewCount || '0');
		const likes = Number.parseInt(video.statistics?.likeCount || '0');
		const comments = Number.parseInt(video.statistics?.commentCount || '0');

		const existing = engagementByDay.get(date) || {impressions: 0, likes: 0, comments: 0};
		engagementByDay.set(date, {
			impressions: existing.impressions + impressions,
			likes: existing.likes + likes,
			comments: existing.comments + comments,
		});
	}

	// Convert to array and sort by date (newest first)
	return Array.from(engagementByDay.entries()).sort(([a], [b]) => b.localeCompare(a));
};
