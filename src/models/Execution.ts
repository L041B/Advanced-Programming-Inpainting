// Import necessary modules from Sequelize and other parts of the application.
import { DataTypes, Model, Sequelize } from 'sequelize';
import { DbConnection } from '../config/database';
import { User } from './User';

// Execution model representing an inpainting job.
export class Execution extends Model {
  public id!: string; 
  public userId!: string;
  public originalImage!: Buffer;
  public maskImage!: Buffer;
  public outputImage!: Buffer;
  public status!: 'pending' | 'processing' | 'completed' | 'failed'; 
  
  // Timestamps managed by Sequelize.
  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;

  // Initializes the Execution model, defining its schema and configuration.
  static initialize() {
    const sequelize: Sequelize = DbConnection.getSequelizeInstance();

    Execution.init(
      {
        id: {
          type: DataTypes.UUID,
          primaryKey: true,
          defaultValue: DataTypes.UUIDV4, // Automatically generate UUID v4 for new records.
        },
        userId: {
          type: DataTypes.UUID,
          allowNull: false,
          references: { 
            model: User,
            key: 'id',
          },
        },
        
        originalImage: {
          type: DataTypes.BLOB,
          allowNull: false,
        },
        maskImage: {
          type: DataTypes.BLOB,
          allowNull: false,
        },
        outputImage: {
          type: DataTypes.BLOB,
          allowNull: true, 
        },
        status: {
          type: DataTypes.ENUM('pending', 'processing', 'completed', 'failed'),
          allowNull: false,
          defaultValue: 'pending',
        },
      },
      {
        sequelize,
        modelName: 'Execution',
        tableName: 'executions',
        timestamps: true, 
        underscored: true,
      }
    );
  }

  // Defines the associations for the Execution model.
  static associate() {
    // An Execution belongs to a single User.
    Execution.belongsTo(User, { 
        foreignKey: 'userId', 
        as: 'user' // Alias for accessing the user of an execution
    });
  }
}

// Initialize the model to register it with Sequelize.
Execution.initialize();