import { BaseProvider } from '@omss/framework';
import type {
    ProviderCapabilities,
    ProviderMediaObject,
    ProviderResult,
    Source,
    Subtitle
} from '@omss/framework';

interface ConsumetEpisode {
    id: string;
    title: string;
    number: number;
    season?: number;
}

interface ConsumetSource {
    url: string;
    quality: string;
    isM3U8?: boolean;
    isDASH?: boolean;
    size?: number;
}

interface ConsumetSubtitle {
    url: string;
    lang: string;
}

interface ConsumetResponse {
    sources: ConsumetSource[];
    subtitles?: ConsumetSubtitle[];
}

const CONSUMET_INSTANCES = [
    'https://api.consumet.org',
];

export class CinemaOSProvider extends BaseProvider {
    readonly id = 'cinemaos';
    readonly name = 'CinemaOS';
    readonly enabled = true;
    readonly BASE_URL = 'https://cinemaos.in';
    readonly HEADERS = {
        'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150 Safari/537.36',
        Referer: this.BASE_URL
    };

    readonly capabilities: ProviderCapabilities = {
        supportedContentTypes: ['movies', 'tv']
    };

    async getMovieSources(media: ProviderMediaObject): Promise<ProviderResult> {
        return this.getSources(media, 'movie');
    }

    async getTVSources(media: ProviderMediaObject): Promise<ProviderResult> {
        return this.getSources(media, 'tv');
    }

    private async getSources(
        media: ProviderMediaObject,
        type: 'movie' | 'tv'
    ): Promise<ProviderResult> {
        const errors: string[] = [];

        for (const instance of CONSUMET_INSTANCES) {
            try {
                const result = await this.tryConsumet(media, type, instance);
                if (result) return result;
            } catch (e) {
                errors.push(
                    `${instance}: ${e instanceof Error ? e.message : 'error'}`
                );
            }
        }

        return this.emptyResult(
            `All sources failed: ${errors.join('; ')}`,
            media
        );
    }

    private async tryConsumet(
        media: ProviderMediaObject,
        type: 'movie' | 'tv',
        instance: string
    ): Promise<ProviderResult | null> {
        let episodeId: string;
        let mediaId: string;

        if (type === 'movie') {
            const infoUrl = `${instance}/meta/tmdb/info/${media.tmdbId}?type=movie`;
            const infoResp = await fetch(infoUrl, { headers: this.HEADERS });
            if (!infoResp.ok) return null;

            const info = await infoResp.json() as any;
            const episode = info?.episodes?.[0];
            if (!episode?.id) return null;

            episodeId = episode.id;
            mediaId = `movie/${media.tmdbId}`;
        } else {
            episodeId = `${media.tmdbId}-${media.s}-${media.e}`;
            const infoUrl = `${instance}/meta/tmdb/info/${media.tmdbId}?type=tv`;
            const infoResp = await fetch(infoUrl, { headers: this.HEADERS });
            if (!infoResp.ok) return null;

            const info = await infoResp.json() as any;
            const season = info?.seasons?.find(
                (s: any) => s.season === media.s
            );
            const episode = season?.episodes?.find(
                (e: any) => e.number === media.e
            );
            if (!episode?.id) return null;

            episodeId = episode.id;
            mediaId = `tv/${media.tmdbId}`;
        }

        const watchUrl = `${instance}/meta/tmdb/watch/${episodeId}?id=${mediaId}`;
        const watchResp = await fetch(watchUrl, { headers: this.HEADERS });
        if (!watchResp.ok) return null;

        const data = await watchResp.json() as ConsumetResponse;
        if (!data?.sources?.length) return null;

        const sources: Source[] = data.sources.map((s) => ({
            url: this.createProxyUrl(s.url, this.HEADERS),
            type: s.isM3U8 ? 'hls' : s.isDASH ? 'dash' : 'mp4',
            quality: s.quality || 'Auto',
            audioTracks: [
                {
                    label: 'Original',
                    language: 'Original'
                }
            ],
            provider: {
                id: this.id,
                name: this.name
            }
        }));

        const subtitles: Subtitle[] = (data.subtitles ?? []).map((sub) => ({
            url: sub.url,
            label: sub.lang,
            format: 'vtt'
        }));

        return { sources, subtitles, diagnostics: [] };
    }

    private emptyResult(
        message: string,
        media: ProviderMediaObject
    ): ProviderResult {
        return {
            sources: [],
            subtitles: [],
            diagnostics: [
                {
                    code: 'PROVIDER_ERROR',
                    message: `${this.name}: ${message}. CinemaOS relies on the Consumet API which may be unavailable.`,
                    field: '',
                    severity: 'error'
                }
            ]
        };
    }

    async healthCheck(): Promise<boolean> {
        try {
            const response = await fetch(this.BASE_URL, {
                method: 'HEAD',
                headers: this.HEADERS
            });
            return response.status === 200;
        } catch {
            return false;
        }
    }
}
