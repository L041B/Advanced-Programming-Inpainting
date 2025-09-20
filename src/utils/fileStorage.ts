import path from "path";
import fs from "fs/promises";
import { v4 as uuidv4 } from "uuid";

export class FileStorage {
    private static readonly UPLOAD_DIR = path.join(process.cwd(), "uploads");
    private static readonly DATASETS_DIR = path.join(FileStorage.UPLOAD_DIR, "datasets");
    private static readonly TEMP_DIR = path.join(FileStorage.UPLOAD_DIR, "temp");

    // Initialize storage directories
    static async init(): Promise<void> {
        await fs.mkdir(FileStorage.UPLOAD_DIR, { recursive: true });
        await fs.mkdir(FileStorage.DATASETS_DIR, { recursive: true });
        await fs.mkdir(FileStorage.TEMP_DIR, { recursive: true });
    }

    // Save buffer to disk and return relative file path
    static async saveFile(buffer: Buffer, originalName: string, subfolder?: string): Promise<string> {
        const ext = path.extname(originalName);
        const filename = `${uuidv4()}${ext}`;
        const directory = subfolder 
            ? path.join(FileStorage.DATASETS_DIR, subfolder)
            : FileStorage.DATASETS_DIR;
        
        await fs.mkdir(directory, { recursive: true });
        const filePath = path.join(directory, filename);
        await fs.writeFile(filePath, buffer);
        
        // Return relative path from uploads directory
        return path.relative(FileStorage.UPLOAD_DIR, filePath);
    }

    // Save multiple files and return paths
    static async saveFiles(files: Array<{ buffer: Buffer; name: string }>, subfolder?: string): Promise<string[]> {
        const paths: string[] = [];
        for (const file of files) {
            const filePath = await this.saveFile(file.buffer, file.name, subfolder);
            paths.push(filePath);
        }
        return paths;
    }

    // Read file from disk
    static async readFile(relativePath: string): Promise<Buffer> {
        const fullPath = path.join(FileStorage.UPLOAD_DIR, relativePath);
        return await fs.readFile(fullPath);
    }

    // Delete file from disk
    static async deleteFile(relativePath: string): Promise<void> {
        const fullPath = path.join(FileStorage.UPLOAD_DIR, relativePath);
        try {
            await fs.unlink(fullPath);
        } catch (error) {
            console.error(`Failed to delete file ${fullPath}:`, error);
        }
    }

    // Get absolute path from relative path
    static getAbsolutePath(relativePath: string): string {
        return path.join(FileStorage.UPLOAD_DIR, relativePath);
    }

    // Get temp directory path
    static getTempDir(): string {
        return FileStorage.TEMP_DIR;
    }

    // Clean up temporary files
    static async cleanupTempFiles(filePaths: string[]): Promise<void> {
        for (const filePath of filePaths) {
            try {
                await fs.unlink(filePath);
            } catch (error) {
                console.error(`Failed to delete temp file ${filePath}:`, error);
            }
        }
    }
}
