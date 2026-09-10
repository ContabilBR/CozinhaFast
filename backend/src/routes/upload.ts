import type { FastifyRequest, FastifyReply } from "fastify";
import type { App } from "../index.js";
import { randomUUID } from "crypto";
import { requireAuth as customRequireAuth } from "../utils/auth.js";

// MIME type to file extension mapping
const mimeTypeExtensions: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/jpg": ".jpg",
  "image/png": ".png",
  "image/gif": ".gif",
  "image/webp": ".webp",
  "image/svg+xml": ".svg",
  "image/bmp": ".bmp",
  "image/tiff": ".tiff",
  "application/pdf": ".pdf",
  "text/plain": ".txt",
  "application/json": ".json",
};

export function registerUploadRoutes(app: App) {

  // POST /api/upload/imagem - Upload an image file
  app.fastify.post(
    "/api/upload/imagem",
    {
      schema: {
        description: "Upload an image file (requires authentication)",
        tags: ["upload"],
        response: {
          200: {
            type: "object",
            properties: {
              url: { type: "string" },
            },
          },
          400: { type: "object", properties: { error: { type: "string" } } },
          401: { type: "object", properties: { error: { type: "string" } } },
          413: { type: "object", properties: { error: { type: "string" } } },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const session = await customRequireAuth(app, request, reply);
      if (!session) return;

      try {
        // Get the file from multipart form data
        const data = await request.file({ limits: { fileSize: 10 * 1024 * 1024 } }); // 10MB limit

        if (!data) {
          app.logger.warn({}, "No file provided in upload request");
          return reply.code(400).send({ error: "No file provided" });
        }

        let buffer: Buffer;
        try {
          buffer = await data.toBuffer();
        } catch (error) {
          app.logger.warn({ err: error }, "File too large");
          return reply.code(413).send({ error: "File too large" });
        }

        const mimeType = data.mimetype || "application/octet-stream";
        const extension = mimeTypeExtensions[mimeType] || ".bin";
        const filename = `${randomUUID()}${extension}`;
        const key = `uploads/${filename}`;

        app.logger.info(
          { filename, mimeType, size: buffer.length },
          "Uploading file to storage"
        );

        // Upload to storage
        const uploadedKey = await app.storage.upload(key, buffer);

        // Get signed URL for client access
        const { url } = await app.storage.getSignedUrl(uploadedKey);

        app.logger.info({ filename, url }, "File uploaded successfully");

        return reply.code(200).send({ url });
      } catch (error) {
        app.logger.error({ err: error }, "Failed to upload file");
        return reply.code(500).send({ error: "Internal server error" });
      }
    }
  );

  // POST /api/upload - Upload a file (generic endpoint)
  app.fastify.post(
    "/api/upload",
    {
      schema: {
        description: "Upload a file (requires authentication)",
        tags: ["upload"],
        response: {
          200: {
            type: "object",
            properties: {
              url: { type: "string" },
            },
          },
          400: { type: "object", properties: { error: { type: "string" } } },
          401: { type: "object", properties: { error: { type: "string" } } },
          413: { type: "object", properties: { error: { type: "string" } } },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const session = await customRequireAuth(app, request, reply);
      if (!session) return;

      try {
        // Get the file from multipart form data
        const data = await request.file({ limits: { fileSize: 10 * 1024 * 1024 } }); // 10MB limit

        if (!data) {
          app.logger.warn({}, "No file provided in upload request");
          return reply.code(400).send({ error: "No file provided" });
        }

        let buffer: Buffer;
        try {
          buffer = await data.toBuffer();
        } catch (error) {
          app.logger.warn({ err: error }, "File too large");
          return reply.code(413).send({ error: "File too large" });
        }

        const mimeType = data.mimetype || "application/octet-stream";
        const extension = mimeTypeExtensions[mimeType] || ".bin";
        const filename = `${randomUUID()}${extension}`;
        const key = `uploads/${filename}`;

        app.logger.info(
          { filename, mimeType, size: buffer.length },
          "Uploading file to storage"
        );

        // Upload to storage
        const uploadedKey = await app.storage.upload(key, buffer);

        // Get signed URL for client access
        const { url } = await app.storage.getSignedUrl(uploadedKey);

        app.logger.info({ filename, url }, "File uploaded successfully");

        return reply.code(200).send({ url });
      } catch (error) {
        app.logger.error({ err: error }, "Failed to upload file");
        return reply.code(500).send({ error: "Internal server error" });
      }
    }
  );
}
