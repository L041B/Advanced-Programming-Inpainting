import { Dataset } from "../models/Dataset";
import { Sequelize, Op } from "sequelize";
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
            // Check for existing dataset only for the SAME user (not globally)
            if (datasetData.userId) {
                const existingDataset = await Dataset.findOne({
                    where: { 
                        userId: datasetData.userId,  // Only check within the same user's datasets
                        name: datasetData.name, 
                        isDeleted: false 
                    },
                    transaction: t
                });
                
                if (existingDataset) {
                    throw new Error("Dataset with this name already exists");
                }
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
            // FIXED: Find dataset by BOTH userId and name, ensuring we're updating the right dataset
            const dataset = await Dataset.findOne({
                where: { 
                    userId,  // Add userId to the search criteria
                    name, 
                    isDeleted: false
                },
                transaction: t
            });
            
            if (!dataset) {
                console.error(`Dataset not found for update: userId=${userId}, name=${name}`);
                throw new Error("Dataset not found");
            }

            // Log the update operation for debugging
            console.log(`Updating dataset ${dataset.name} for user ${userId} with:`, {
                hasData: !!datasetData.data,
                dataSize: datasetData.data ? JSON.stringify(datasetData.data).length : 0,
                nextUploadIndex: datasetData.nextUploadIndex,
                tags: datasetData.tags,
                newName: datasetData.name
            });

            // Perform the update
            const [affectedRows] = await Dataset.update(datasetData, { 
                where: {
                    id: dataset.id
                },
                transaction: t 
            });

            if (affectedRows === 0) {
                console.error(`No rows affected during update for dataset: ${dataset.id}`);
                throw new Error("Failed to update dataset - no rows affected");
            }

            // Reload the updated dataset to return fresh data
            const updatedDataset = await Dataset.findByPk(dataset.id, { transaction: t });
            
            if (!updatedDataset) {
                console.error(`Could not reload dataset after update: ${dataset.id}`);
                throw new Error("Dataset disappeared after update");
            }

            // Log successful update with actual values
            console.log(`Dataset updated successfully. ID: ${updatedDataset.id}, Name: ${updatedDataset.name}, NextUploadIndex: ${updatedDataset.nextUploadIndex}, DataSize: ${updatedDataset.data ? JSON.stringify(updatedDataset.data).length : 0}`);
            
            return updatedDataset;
        });
    }

    public async delete(userId: string, name: string): Promise<boolean> {
        return await this.sequelize.transaction(async (t) => {
            const dataset = await Dataset.findOne({
                where: { 
                    name, 
                    isDeleted: false,
                    userId: { [Op.ne]: null } // Ensure userId is not null
                },
                transaction: t
            });
            
            if (!dataset) {
                return false;
            }

            await dataset.update({ isDeleted: true }, { transaction: t });
            return true;
        });
    }

    // Soft delete tutti i dataset di un utente specifico
    public async softDeleteAllByUserId(userId: string): Promise<number> {
        return await this.sequelize.transaction(async (t) => {
            // Marca come eliminati solo i dataset NON già eliminati
            const [affectedCount] = await Dataset.update(
                { isDeleted: true },
                {
                    where: { 
                        userId, 
                        isDeleted: false // Solo quelli non già eliminati
                    },
                    transaction: t
                }
            );
            
            console.log(`Soft deleted ${affectedCount} datasets for user ${userId}`);
            return affectedCount;
        });
    }

    // Trova tutti i dataset dell'utente INCLUSI quelli eliminati
    public async findAllByUserIdIncludingDeleted(userId: string): Promise<Dataset[]> {
        return await Dataset.findAll({
            where: { userId }, // Non filtrare per isDeleted - mostra tutto
            order: [["createdAt", "DESC"]]
        });
    }

    // Trova dataset NON eliminati (comportamento normale)
    public async findAllByUserId(userId: string): Promise<Dataset[]> {
        return await Dataset.findAll({
            where: { 
                userId, 
                isDeleted: false // Solo quelli attivi
            },
            order: [["createdAt", "DESC"]]
        });
    }

    // Find dataset by ID, allowing null userId for orphaned datasets
    public async findById(datasetId: string): Promise<Dataset | null> {
        return await Dataset.findOne({
            where: { id: datasetId, isDeleted: false }
            // Note: Don't filter by userId here since we want to find orphaned datasets too
        });
    }

    public async findByUserIdAndName(userId: string, name: string): Promise<Dataset | null> {
        return await Dataset.findOne({
            where: { 
                userId,  // Ensure we're looking within the specific user's datasets
                name, 
                isDeleted: false
            }
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
            where: { 
                userId,  // Only check within the specific user's datasets
                name, 
                isDeleted: false
            },
            attributes: ["id"]  // Changed from ["userId"] to ["id"] for better performance
        });
        return !!dataset;
    }
}
