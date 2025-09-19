import { DataTypes, Model, Sequelize } from "sequelize";
import { DbConnection } from "../config/database";

export class Inference extends Model {
  public id!: string;
  public status!: "PENDING" | "RUNNING" | "COMPLETED" | "FAILED" | "ABORTED";
  public modelId!: string;
  public parameters!: Record<string, unknown> | null;
  public result!: Record<string, unknown> | null;
  public datasetId!: string; // Changed from datasetName to datasetId
  public userId!: string;
  
  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;

  static initialize() {
    const sequelize: Sequelize = DbConnection.getSequelizeInstance();

    Inference.init(
      {
        id: {
          type: DataTypes.UUID,
          defaultValue: DataTypes.UUIDV4,
          primaryKey: true,
        },
        status: {
          type: DataTypes.ENUM("PENDING", "RUNNING", "COMPLETED", "FAILED", "ABORTED"),
          allowNull: false,
          defaultValue: "PENDING"
        },
        modelId: {
          type: DataTypes.STRING(255),
          allowNull: false,
          field: "model_id"
        },
        parameters: {
          type: DataTypes.JSONB,
          allowNull: true
        },
        result: {
          type: DataTypes.JSONB,
          allowNull: true
        },
        datasetId: {
          type: DataTypes.UUID,
          allowNull: false,
          field: "dataset_id" // Changed from dataset_name
        },
        userId: {
          type: DataTypes.UUID,
          allowNull: false,
          field: "user_id"
        }
      },
      {
        sequelize,
        modelName: "Inference",
        tableName: "inferences",
        timestamps: true,
        underscored: true,
      }
    );
  }

  static associate() {
    // Associations will be set up in the index file
  }
}

Inference.initialize();


