// Import necessary models and modules from Sequelize and the database configuration.
import { Execution } from "../models/Execution";
import { User } from "../models/User";
import { Sequelize } from "sequelize";
import { DbConnection } from "../config/database";

/** A Data Access Object (DAO) for the Execution model.
 * It provides an abstracted interface for all database operations related to Executions.
 * Implemented as a Singleton to ensure a single point of access.
 */
export class ExecutionDao {
    private static instance: ExecutionDao;
    private readonly sequelize: Sequelize;

    private constructor() {
        this.sequelize = DbConnection.getSequelizeInstance();
    }

    // Gets the singleton instance of ExecutionDao.
    public static getInstance(): ExecutionDao {
        if (!ExecutionDao.instance) {
            ExecutionDao.instance = new ExecutionDao();
        }
        return ExecutionDao.instance;
    }

    // Creates a new execution record in the database.
    public async create(executionData: {
        userId: string;
        originalImage: Buffer;
        maskImage: Buffer;
        outputImage?: Buffer;
        status?: "pending" | "processing" | "completed" | "failed";
    }): Promise<Execution> {
        return await Execution.create({
            ...executionData,
            outputImage: executionData.outputImage || Buffer.alloc(0),
            status: executionData.status || "pending",
        });
    }

    // Updates an existing execution record within a transaction for data integrity.
    public async update(id: string, userId: string, executionData: Partial<Omit<Execution, "id" | "userId">>): Promise<Execution> {
        return await this.sequelize.transaction(async (t) => {
            const execution = await Execution.findOne({
                where: { id, userId }, 
                transaction: t
            });
            
            if (!execution) {
                throw new Error("Execution not found or user is not authorized");
            }

            // Perform the update within the transaction.
            await execution.update(executionData, { transaction: t });
            return execution;
        });
    }


    // Updates only the status of an execution, verifying ownership.
    public async updateStatus(id: string, userId: string, status: "pending" | "processing" | "completed" | "failed"): Promise<void> {
        await Execution.update({ status }, { where: { id, userId } });
    }

    // Updates the output image and status of an execution, verifying ownership.
    public async updateOutput(id: string, userId: string, outputImage: Buffer, status: "completed" | "failed"): Promise<void> {
        await Execution.update({ outputImage, status }, { where: { id, userId } });
    }

    // Deletes an execution record, verifying ownership by matching both ID and user ID.
    public async deleteByIdAndUserId(id: string, userId: string): Promise<number> {
        return await Execution.destroy({ where: { id, userId } });
    }

    // Finds an execution by its ID, including user information.
    public async findByIdWithUser(id: string): Promise<Execution | null> {
        return await Execution.findByPk(id, {
            include: [{
                model: User,
                as: "user",
                attributes: ["id", "name", "surname", "email"]
            }],
            attributes: ["id", "userId", "status", "created_at", "updated_at"]
        });
    }
    
    // Retrieves all executions for a given user.
    public async findByUserId(userId: string, orderBy: "ASC" | "DESC" = "DESC"): Promise<Execution[]> {
        return await Execution.findAll({
            where: { userId },
            attributes: ["id", "userId", "status", "created_at", "updated_at"],
            order: [["created_at", orderBy]]
        });
    }

    // Checks if a given user is the owner of a specific execution.
    public async isOwner(executionId: string, userId: string): Promise<boolean> {
        const count = await Execution.count({ 
            where: { id: executionId, userId: userId } 
        });
        return count > 0;
    }

    // Finds an execution by its ID, including image buffers.
    public async findByIdWithImages(id: string): Promise<Execution | null> {
        return await Execution.findByPk(id, {
            attributes: ["id", "userId", "originalImage", "maskImage", "outputImage"]
        });
    }

    // Finds an execution by its ID, including status and output image.
    public async findByIdForDownload(id: string): Promise<Execution | null> {
        return await Execution.findByPk(id, {
            attributes: ["id", "userId", "status", "outputImage"]
        });
    }

    // Retrieves basic info for an execution, including its user ID.
    public async findByIdBasicInfo(id: string): Promise<Execution | null> {
        return await Execution.findOne({
            where: { id },
            attributes: ["id", "status", "created_at", "userId"] // adjust attributes as needed
        });
    }
}