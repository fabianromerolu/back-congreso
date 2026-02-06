import { Injectable } from "@nestjs/common";
import { v2 as cloudinary, UploadApiResponse } from "cloudinary";

@Injectable()
export class CloudinaryService {
  constructor() {
    cloudinary.config({
      cloud_name: process.env.CLOUDINARY_CLOUD_NAME!,
      api_key: process.env.CLOUDINARY_API_KEY!,
      api_secret: process.env.CLOUDINARY_API_SECRET!,
      secure: true,
    });
  }

  uploadPdf(buffer: Buffer, filename: string, folder: string) {
    return this.uploadFromBuffer(buffer, {
      folder,
      public_id: this.safePublicId(filename),
      resource_type: "raw", // ✅ PDFs van como raw
    });
  }

  uploadPng(buffer: Buffer, filename: string, folder: string) {
    return this.uploadFromBuffer(buffer, {
      folder,
      public_id: this.safePublicId(filename),
      resource_type: "image",
    });
  }

  private uploadFromBuffer(
    buffer: Buffer,
    options: Record<string, any>,
  ): Promise<UploadApiResponse> {
    return new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(options, (err, result) => {
        if (err) return reject(err);
        resolve(result as UploadApiResponse);
      });
      stream.end(buffer);
    });
  }

  private safePublicId(name: string) {
    return name
      .toLowerCase()
      .replace(/\.[^/.]+$/, "") // sin extensión
      .replace(/[^a-z0-9-_]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "");
  }
}
