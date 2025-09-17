import { Dataset } from "../models/Dataset";
import { Sequelize } from "sequelize";
import { DbConnection } from "../config/database";

interface DatasetMutationData {
    userId: string;
    name: string;
    data?: object | null;
    tags?: string[];
    isDeleted?: boolean;
    nextUploadIndex?: number;
}

export class DatasetDao {
    private static instance: DatasetDao;
    private readonly sequelize: Sequelize;

    private constructor() {
        this.sequelize = DbConnection.getSequelizeInstance();
    }

    public static getInstance(): DatasetDao {
        if (!DatasetDao.instance) {
            DatasetDao.instance = new DatasetDao();
        }
        return DatasetDao.instance;
    }

    public async create(datasetData: Required<Omit<DatasetMutationData, "isDeleted" | "nextUploadIndex">>): Promise<Dataset> {
        return await this.sequelize.transaction(async (t) => {
            const existingDataset = await Dataset.findOne({
                where: { userId: datasetData.userId, name: datasetData.name, isDeleted: false },
                transaction: t
            });
            
            if (existingDataset) {
                throw new Error("Dataset with this name already exists");
            }

            return await Dataset.create({
                ...datasetData,
                isDeleted: false,
                nextUploadIndex: 1
            }, { transaction: t });
        });
    }

    public async update(userId: string, name: string, datasetData: Partial<DatasetMutationData>): Promise<Dataset> {
        return await this.sequelize.transaction(async (t) => {
            const dataset = await Dataset.findOne({
                where: { userId, name, isDeleted: false },
                transaction: t
            });
            
            if (!dataset) {
                throw new Error("Dataset not found");
            }

            // Log the update operation for debugging
            console.log(`Updating dataset ${name} with:`, {
                hasData: !!datasetData.data,
                nextUploadIndex: datasetData.nextUploadIndex,
                tags: datasetData.tags
            });

            await dataset.update(datasetData, { transaction: t });
            
            // Log successful update
            console.log(`Dataset ${name} updated successfully. New nextUploadIndex: ${dataset.nextUploadIndex}`);
            
            return dataset;
        });
    }

    public async delete(userId: string, name: string): Promise<boolean> {
        return await this.sequelize.transaction(async (t) => {
            const dataset = await Dataset.findOne({
                where: { userId, name, isDeleted: false },
                transaction: t
            });
            
            if (!dataset) {
                return false;
            }

            await dataset.update({ isDeleted: true }, { transaction: t });
            return true;
        });
    }

    public async findByUserIdAndName(userId: string, name: string): Promise<Dataset | null> {
        return await Dataset.findOne({
            where: { userId, name, isDeleted: false }
        });
    }

    public async findAllByUserId(userId: string): Promise<Dataset[]> {
        return await Dataset.findAll({
            where: { userId, isDeleted: false },
            order: [["createdAt", "DESC"]]
        });
    }

    public async findByUserIdAndNameWithPagination(
        userId: string, 
        limit: number, 
        offset: number
    ): Promise<{ rows: Dataset[], count: number }> {
        return await Dataset.findAndCountAll({
            where: { userId, isDeleted: false },
            order: [["createdAt", "DESC"]],
            limit,
            offset
        });
    }

    public async exists(userId: string, name: string): Promise<boolean> {
        const dataset = await Dataset.findOne({
            where: { userId, name, isDeleted: false },
            attributes: ["userId"]
        });
        return !!dataset;
    }
}
