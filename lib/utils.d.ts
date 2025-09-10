import { Buffer } from 'buffer';
export declare const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";
export declare function getImageTypeFromUrl(url: string): string;
export declare function detectImageType(buffer: Buffer): 'jpeg' | 'png' | null;
export declare function preprocessImage(buffer: Buffer, maxSizeInMB?: number): Promise<Buffer>;
export declare function getImageUrlAndName(session: any, text: string): {
    url: string;
    name: string;
};
