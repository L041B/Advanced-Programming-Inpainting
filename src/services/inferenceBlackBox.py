import os
import cv2
import numpy as np
from flask import Flask, request, jsonify
from PIL import Image
import uuid
import json
import logging
from typing import Dict, List, Any, Tuple
import tempfile
import shutil

# Setup logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = Flask(__name__)

class InferenceBlackBox:
    def __init__(self):
        self.upload_dir = "/usr/src/app/uploads"
        self.output_dir = os.path.join(self.upload_dir, "inferences")
        os.makedirs(self.output_dir, exist_ok=True)

    def process_image_pair(self, image_path: str, mask_path: str) -> np.ndarray:
        """Process a single image-mask pair using inpainting (overlay mask on image)"""
        try:
            # Read image and mask
            image_full_path = os.path.join(self.upload_dir, image_path)
            mask_full_path = os.path.join(self.upload_dir, mask_path)
            
            # Load image
            image = cv2.imread(image_full_path)
            if image is None:
                raise ValueError(f"Could not load image: {image_path}")
            
            # Load mask
            mask = cv2.imread(mask_full_path)
            if mask is None:
                raise ValueError(f"Could not load mask: {mask_path}")
            
            # Resize mask to match image dimensions
            if image.shape[:2] != mask.shape[:2]:
                mask = cv2.resize(mask, (image.shape[1], image.shape[0]))
            
            # Convert mask to grayscale for blending
            mask_gray = cv2.cvtColor(mask, cv2.COLOR_BGR2GRAY)
            mask_normalized = mask_gray.astype(np.float32) / 255.0
            
            # Create alpha channel from mask
            mask_3channel = np.stack([mask_normalized] * 3, axis=-1)
            
            # Blend image and mask (similar to 'lighten' blend mode)
            # This simulates inpainting by overlaying the mask
            result = image.astype(np.float32) * (1 - mask_3channel * 0.5) + mask.astype(np.float32) * (mask_3channel * 0.5)
            result = np.clip(result, 0, 255).astype(np.uint8)
            
            return result
            
        except Exception as e:
            logger.error(f"Error processing image pair: {str(e)}")
            raise

    def save_processed_image(self, image: np.ndarray, user_id: str, filename: str) -> str:
        """Save processed image and return relative path"""
        user_output_dir = os.path.join(self.output_dir, user_id)
        os.makedirs(user_output_dir, exist_ok=True)
        
        output_filename = f"{uuid.uuid4()}_{filename}"
        output_path = os.path.join(user_output_dir, output_filename)
        
        cv2.imwrite(output_path, image)
        
        # Return relative path from uploads directory
        return os.path.relpath(output_path, self.upload_dir)

    def process_video_frames(self, frame_pairs: List[Dict], user_id: str, video_id: str) -> str:
        """Process video frames and reconstruct video"""
        try:
            # Sort frames by frame index
            frame_pairs.sort(key=lambda x: x.get('frameIndex', 0))
            
            # Create temporary directory for frames
            with tempfile.TemporaryDirectory() as temp_dir:
                processed_frames = []
                
                # Process each frame
                for i, pair in enumerate(frame_pairs):
                    processed_image = self.process_image_pair(pair['imagePath'], pair['maskPath'])
                    
                    # Save frame to temp directory
                    frame_filename = f"frame_{i:04d}.png"
                    frame_path = os.path.join(temp_dir, frame_filename)
                    cv2.imwrite(frame_path, processed_image)
                    processed_frames.append(frame_path)
                
                if not processed_frames:
                    raise ValueError("No frames to process")
                
                # Create output video
                user_output_dir = os.path.join(self.output_dir, user_id)
                os.makedirs(user_output_dir, exist_ok=True)
                
                output_filename = f"{uuid.uuid4()}_video_{video_id}.mp4"
                output_path = os.path.join(user_output_dir, output_filename)
                
                # Read first frame to get dimensions
                first_frame = cv2.imread(processed_frames[0])
                height, width, _ = first_frame.shape
                
                # Create video writer with 1 FPS to match original sampling
                # Since we extracted 1 frame per second, we reconstruct at 1 FPS
                fourcc = cv2.VideoWriter_fourcc(*'mp4v')
                fps = 1.0  # 1 FPS - each frame lasts 1 second
                out = cv2.VideoWriter(output_path, fourcc, fps, (width, height))
                
                # Write all frames to video
                for frame_path in processed_frames:
                    frame = cv2.imread(frame_path)
                    if frame is not None:
                        out.write(frame)
                
                out.release()
                
                # Return relative path from uploads directory
                return os.path.relpath(output_path, self.upload_dir)
                
        except Exception as e:
            logger.error(f"Error processing video frames: {str(e)}")
            raise

    def process_dataset(self, user_id: str, dataset_data: Dict, parameters: Dict) -> Dict:
        """Process entire dataset"""
        try:
            logger.info(f"Starting dataset processing for user: {user_id}")
            
            pairs = dataset_data.get('pairs', [])
            if not pairs:
                return {"success": False, "error": "No data pairs found in dataset"}
            
            # Group pairs by video ID (uploadIndex acts as video ID)
            video_groups = {}
            single_images = []
            
            for pair in pairs:
                upload_index = pair.get('uploadIndex')
                frame_index = pair.get('frameIndex')
                
                if frame_index is not None:  # This is a video frame
                    if upload_index not in video_groups:
                        video_groups[upload_index] = []
                    video_groups[upload_index].append(pair)
                else:  # This is a single image
                    single_images.append(pair)
            
            processed_images = []
            processed_videos = []
            
            # Process single images
            for pair in single_images:
                try:
                    processed_image = self.process_image_pair(pair['imagePath'], pair['maskPath'])
                    
                    # Generate output filename
                    original_filename = os.path.basename(pair['imagePath'])
                    name, ext = os.path.splitext(original_filename)
                    output_filename = f"processed_{name}.png"
                    
                    output_path = self.save_processed_image(processed_image, user_id, output_filename)
                    
                    processed_images.append({
                        "originalPath": pair['imagePath'],
                        "outputPath": output_path
                    })
                    
                except Exception as e:
                    logger.error(f"Error processing single image {pair['imagePath']}: {str(e)}")
                    continue
            
            # Process video groups
            for video_id, frame_pairs in video_groups.items():
                try:
                    output_path = self.process_video_frames(frame_pairs, user_id, str(video_id))
                    
                    processed_videos.append({
                        "originalVideoId": str(video_id),
                        "outputPath": output_path
                    })
                    
                except Exception as e:
                    logger.error(f"Error processing video {video_id}: {str(e)}")
                    continue
            
            logger.info(f"Dataset processing completed. Images: {len(processed_images)}, Videos: {len(processed_videos)}")
            
            return {
                "success": True,
                "images": processed_images,
                "videos": processed_videos
            }
            
        except Exception as e:
            logger.error(f"Error in dataset processing: {str(e)}")
            return {"success": False, "error": str(e)}

# Initialize the blackbox service
blackbox = InferenceBlackBox()

@app.route('/process-dataset', methods=['POST'])
def process_dataset():
    try:
        data = request.get_json()
        
        if not data:
            return jsonify({"success": False, "error": "No JSON data provided"}), 400
        
        user_id = data.get('userId')
        dataset_data = data.get('data')
        parameters = data.get('parameters', {})
        
        if not user_id or not dataset_data:
            return jsonify({"success": False, "error": "Missing userId or data"}), 400
        
        result = blackbox.process_dataset(user_id, dataset_data, parameters)
        
        return jsonify(result)
        
    except Exception as e:
        logger.error(f"Error in process_dataset endpoint: {str(e)}")
        return jsonify({"success": False, "error": str(e)}), 500

@app.route('/health', methods=['GET'])
def health_check():
    return jsonify({"status": "healthy", "service": "inference-blackbox"})

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)
