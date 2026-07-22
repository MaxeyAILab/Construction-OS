import { Injectable } from "@nestjs/common";
import sharp from "sharp";

const THUMBNAIL_MAX_DIMENSION_PX = 512;
const SUPPORTED_CONTENT_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/avif",
  "image/tiff",
]);

export interface ThumbnailResult {
  buffer: Buffer;
  contentType: "image/webp";
}

// architecture.md §13's "thumbnailing" step, scoped to raster images only
// (roadmap.md's Phase 1A row title: "presigned uploads, scan, thumbnails").
// PDF page rasterization and EXIF extraction are the same §13 paragraph but
// belong to the Documents module's drawing-set viewer (FR-DOC-3/5, Phase
// 1B) — flagged as a follow-up there rather than built speculatively here
// with no consumer yet.
@Injectable()
export class ThumbnailService {
  supports(contentType: string): boolean {
    return SUPPORTED_CONTENT_TYPES.has(contentType);
  }

  async generate(buffer: Buffer): Promise<ThumbnailResult> {
    const thumbnail = await sharp(buffer)
      .rotate() // auto-orient per EXIF before resizing, then EXIF is stripped
      .resize({
        width: THUMBNAIL_MAX_DIMENSION_PX,
        height: THUMBNAIL_MAX_DIMENSION_PX,
        fit: "inside",
        withoutEnlargement: true,
      })
      .webp({ quality: 80 })
      .toBuffer();
    return { buffer: thumbnail, contentType: "image/webp" };
  }
}
