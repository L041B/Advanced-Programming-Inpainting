import { DataTypes, Model, Sequelize, Op } from "sequelize";
import { DbConnection } from "../config/database";
import { User } from "./User";
import { Dataset } from "./Dataset";

export class Inference extends Model {
  public id!: string;
  public status!: "PENDING" | "RUNNING" | "COMPLETED" | "FAILED" | "ABORTED";
  public modelId!: string;
  public parameters!: Record<string, unknown>;
  public result!: Record<string, unknown>;
  public datasetName!: string;
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
          defaultValue: "PENDING",
        },
        modelId: {
          type: DataTypes.STRING(255),
          allowNull: false,
          field: "model_id",
        },
        parameters: {
          type: DataTypes.JSONB,
          allowNull: true,
        },
        result: {
          type: DataTypes.JSONB,
          allowNull: true,
        },
        datasetName: {
          type: DataTypes.STRING(255),
          allowNull: false,
          field: "dataset_name",
        },
        userId: {
          type: DataTypes.UUID,
          allowNull: false,
          field: "user_id",
        },
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
    Inference.belongsTo(User, { foreignKey: "userId", as: "user" });
    Inference.belongsTo(Dataset, {
      foreignKey: "datasetName",
      targetKey: "name",
      constraints: false,
      scope: {
        userId: {
          [Op.col]: "Inference.userId"
        }
      },
      as: "dataset"
    });
  }
}

Inference.initialize();
