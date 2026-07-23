import { Module } from "@nestjs/common";
import { loadEnv } from "../../config/env";
import { createDatabase, DATABASE } from "../../infrastructure/db/client";
import { EventsModule } from "../events";
import { FilesModule } from "../files";
import { PhotosController } from "./api/photos.controller";
import { PhotosService } from "./application/photos.service";

const env = loadEnv();

@Module({
  imports: [EventsModule, FilesModule],
  controllers: [PhotosController],
  providers: [{ provide: DATABASE, useFactory: () => createDatabase(env) }, PhotosService],
  exports: [PhotosService],
})
export class PhotosModule {}
