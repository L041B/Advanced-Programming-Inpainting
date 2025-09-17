import { DataTypes, Model, Sequelize } from "sequelize";
import { DbConnection } from "../config/database";

export class Dataset extends Model {
  public userId!: string;
  public name!: string;
  public data!: object | null;
  public tags!: string[];
  public isDeleted!: boolean;
  public nextUploadIndex!: number;
  
  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;

  static initialize() {
    const sequelize: Sequelize = DbConnection.getSequelizeInstance();

    Dataset.init(
      {
        userId: {
          type: DataTypes.UUID,
          allowNull: false,
          primaryKey: true,
          field: "user_id",
          references: {
            model: "users",
            key: "id"
          }
        },
        name: {
          type: DataTypes.STRING(255),
          allowNull: false,
          primaryKey: true,
        },
        data: {
          type: DataTypes.JSONB,
          allowNull: true,
        },
        tags: {
          type: DataTypes.ARRAY(DataTypes.TEXT),
          allowNull: false,
          defaultValue: [],
        },
        isDeleted: {
          type: DataTypes.BOOLEAN,
          allowNull: false,
          defaultValue: false,
          field: "is_deleted",
        },
        nextUploadIndex: {
          type: DataTypes.INTEGER,
          allowNull: false,
          defaultValue: 1,
          field: "next_upload_index",
        },
      },
      {
        sequelize,
        modelName: "Dataset",
        tableName: "datasets",
        timestamps: true,
        underscored: true,
        indexes: [
          {
            fields: ["user_id", "name"],
            unique: true,
            where: { is_deleted: false },
            name: "unique_user_dataset_name"
          },
          {
            fields: ["user_id"],
            name: "idx_datasets_user_id_model"
          }
        ]
      }
    );
  }

  static associate() {
    // Le associazioni verranno definite dopo che tutti i modelli sono inizializzati
  }
}

Dataset.initialize();
