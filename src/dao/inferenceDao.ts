import { Inference } from "../models/Inference";
import { Sequelize } from "sequelize";
import { DbConnection } from "../config/database";

interface InferenceMutationData {
    status: "PENDING" | "RUNNING" | "COMPLETED" | "FAILED" | "ABORTED";
    modelId: string;
    parameters?: Record<string, unknown>;
    result?: Record<string, unknown>;
    datasetName: string;
    userId: string;
}

export class InferenceDao {
    private static instance: InferenceDao;
    private readonly sequelize: Sequelize;

    private constructor() {
        this.sequelize = DbConnection.getSequelizeInstance();
    }

    public static getInstance(): InferenceDao {
        if (!InferenceDao.instance) {
            InferenceDao.instance = new InferenceDao();
        }
        return InferenceDao.instance;
    }

    public async create(inferenceData: Omit<InferenceMutationData, "result">): Promise<Inference> {
        return await this.sequelize.transaction(async (t) => {
            return await Inference.create({
                ...inferenceData,
                result: null
            }, { transaction: t });
        });
    }

    public async update(id: string, inferenceData: Partial<InferenceMutationData>): Promise<Inference> {
        return await this.sequelize.transaction(async (t) => {
            const inference = await Inference.findByPk(id, { transaction: t });
            if (!inference) {
                throw new Error("Inference not found");
            }

            await inference.update(inferenceData, { transaction: t });
            return inference;
        });
    }

    public async updateStatus(id: string, status: InferenceMutationData["status"], result?: Record<string, unknown>): Promise<void> {
        await this.sequelize.transaction(async (t) => {
            await Inference.update(
                { status, ...(result && { result }) },
                { where: { id }, transaction: t }
            );
        });
    }

    public async findById(id: string): Promise<Inference | null> {
        return await Inference.findByPk(id);
    }

    public async findByIdAndUserId(id: string, userId: string): Promise<Inference | null> {
        return await Inference.findOne({
            where: { id, userId }
        });
    }

    public async findAllByUserId(userId: string): Promise<Inference[]> {
        return await Inference.findAll({
            where: { userId },
            order: [["createdAt", "DESC"]]
        });
    }

    public async findByUserIdWithPagination(
        userId: string, 
        limit: number, 
        offset: number
    ): Promise<{ rows: Inference[], count: number }> {
        return await Inference.findAndCountAll({
            where: { userId },
            order: [["createdAt", "DESC"]],
            limit,
            offset,
            attributes: ["id", "status", "modelId", "datasetName", "createdAt", "updatedAt"]
        });
    }
}
