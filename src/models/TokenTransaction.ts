import { DataTypes, Model, Sequelize } from "sequelize";
import { DbConnection } from "../config/database";

export class TokenTransaction extends Model {
  public id!: string;
  public userId!: string;
  public operationType!: "dataset_upload" | "inference" | "admin_recharge" | "refund";
  public operationId!: string | null;
  public amount!: number; // Positive for recharge, negative for usage
  public balanceBefore!: number;
  public balanceAfter!: number;
  public status!: "pending" | "completed" | "refunded";
  public description!: string | null;
  
  public readonly createdAt!: Date;

  static initialize() {
    const sequelize: Sequelize = DbConnection.getSequelizeInstance();

    TokenTransaction.init(
      {
        id: {
          type: DataTypes.UUID,
          defaultValue: DataTypes.UUIDV4,
          primaryKey: true,
        },
        userId: {
          type: DataTypes.UUID,
          allowNull: false,
          field: "user_id",
        },
        operationType: {
          type: DataTypes.STRING(50),
          allowNull: false,
          field: "operation_type",
        },
        operationId: {
          type: DataTypes.STRING(255),
          allowNull: true,
          field: "operation_id",
        },
        amount: {
          type: DataTypes.DECIMAL(10, 2),
          allowNull: false,
        },
        balanceBefore: {
          type: DataTypes.DECIMAL(10, 2),
          allowNull: false,
          field: "balance_before",
        },
        balanceAfter: {
          type: DataTypes.DECIMAL(10, 2),
          allowNull: false,
          field: "balance_after",
        },
        status: {
          type: DataTypes.STRING(20),
          allowNull: false,
          defaultValue: "completed",
        },
        description: {
          type: DataTypes.TEXT,
          allowNull: true,
        },
      },
      {
        sequelize,
        modelName: "TokenTransaction",
        tableName: "token_transactions",
        timestamps: true,
        updatedAt: false, // Only track creation time
        underscored: true,
      }
    );
  }

  static associate() {
    // Associations will be set up in the index file
  }
}
