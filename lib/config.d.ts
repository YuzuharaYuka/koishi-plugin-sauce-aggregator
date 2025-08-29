import { Schema, Context, h } from 'koishi';
import { Buffer } from 'buffer';
export interface SearchOptions {
    imageUrl: string;
    imageBuffer: Buffer;
    fileName: string;
    maxResults: number;
}
export declare namespace Searcher {
    interface Result {
        thumbnail: string;
        similarity: number;
        url: string;
        source?: string;
        author?: string;
        time?: string;
        details?: string[];
        coverImage?: string;
        videoPreview?: ArrayBuffer;
    }
}
export interface EnhancedResult {
    details: h[];
    imageBuffer?: Buffer;
    imageType?: string;
}
export declare abstract class Enhancer<T = any> {
    ctx: Context;
    config: T;
    debug: boolean;
    abstract name: 'yandere' | 'gelbooru';
    constructor(ctx: Context, config: T, debug: boolean);
    abstract enhance(result: Searcher.Result): Promise<EnhancedResult | null>;
}
export declare abstract class Searcher<T = any> {
    ctx: Context;
    config: T;
    debug: boolean;
    abstract name: string;
    constructor(ctx: Context, config: T, debug: boolean);
    abstract search(options: SearchOptions): Promise<Searcher.Result[]>;
}
export interface Config {
    debug: boolean;
    order: {
        engine: 'saucenao' | 'iqdb' | 'tracemoe';
        enabled: boolean;
    }[];
    enhancerOrder: {
        engine: 'yandere' | 'gelbooru';
        enabled: boolean;
    }[];
    confidenceThreshold: number;
    maxResults: number;
    promptTimeout: number;
    saucenao: SauceNAO.Config;
    tracemoe: TraceMoe.Config;
    iqdb: IQDB.Config;
    yandere: YandeRe.Config;
    gelbooru: Gelbooru.Config;
}
export declare namespace SauceNAO {
    interface Config {
        apiKeys: string[];
    }
}
export declare namespace TraceMoe {
    interface Config {
        sendVideoPreview: boolean;
    }
}
export declare namespace IQDB {
    interface Config {
    }
}
export declare namespace YandeRe {
    interface Config {
        enabled: boolean;
        postQuality: 'jpeg' | 'sample' | 'original';
        maxRating: 's' | 'q' | 'e';
    }
}
export declare namespace Gelbooru {
    interface Config {
        enabled: boolean;
        keyPairs: {
            userId: string;
            apiKey: string;
        }[];
        postQuality: 'original' | 'sample' | 'preview';
        maxRating: 'general' | 'sensitive' | 'questionable' | 'explicit';
    }
}
export declare const Config: Schema<Config>;
