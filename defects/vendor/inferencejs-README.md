# Roboflow Inference JS

An edge library for deploying computer vision applications built with Roboflow to JS environments.

## Installation

This library is designed to be used within the browser, using a bundler such as vite, webpack, parcel, etc. Assuming your bundler is set up, you can install by executing:

`npm install inferencejs`

## Getting Started

Begin by initializing the `InferenceEngine`. This will start a background worker which is able to download and
execute models without blocking the user interface.

```typescript
import { InferenceEngine } from "inferencejs";

const PUBLISHABLE_KEY = "rf_a6cd..."; // replace with your own publishable key from Roboflow

const inferEngine = new InferenceEngine();

// Load a model by its model id — copy it from the model's page on Roboflow.
// It has the form "{workspace}/{model-slug}", e.g. "my-workspace/hard-hat-abc-1-yolov8n-t1".
const workerId = await inferEngine.startWorkerByModelId("[MODEL ID]", PUBLISHABLE_KEY);

//make inferences against the model
const result = await inferEngine.infer(workerId, img);
```

> Older, project-versioned models can still be loaded by project slug + version number with
> [`startWorker`](#startworkermodelname-string-modelversion-number-publishablekey-string-promisenumber).

## API

### InferenceEngine

#### `new InferenceEngine()`

Creates a new InferenceEngine instance.

#### `startWorkerByModelId(modelId: string, publishableKey: string): Promise<number>`

Starts a new worker for the given model id and returns the `workerId`. This is the recommended way to load a model — `modelId` is the full `{workspace}/{model-slug}` id shown on the model's page (copy it directly), and it works for versionless / multi-model-per-version models. **Important** — `publishableKey` is required and can be obtained from Roboflow in your project settings folder.

#### `startWorker(modelName: string, modelVersion: number, publishableKey: string): Promise<number>`

Legacy: starts a new worker for a project-versioned model (project url slug + integer version) and returns the `workerId`. Prefer `startWorkerByModelId` for new integrations; use this only for legacy models addressed by project + version. **Important** — `publishableKey` is required and can be obtained from Roboflow in your project settings folder.

#### `infer(workerId: number, img: CVImage | ImageBitmap): Promise<Inference>`

Infer on n image using the worker with the given `workerId`. `img` can be created using `new CVImage(HTMLImageElement | HTMLVideoElement | ImageBitmap | TFJS.Tensor)` or [`createImageBitmap`](https://developer.mozilla.org/en-US/docs/Web/API/createImageBitmap)

#### `stopWorker(workerId: number): Promise<void>`

Stops the worker with the given `workerId`.

### `YOLOv8` `YOLOv5` `YOLOv11` `YOLO26` `YOLOLite`

The result of making an inference using the `InferenceEngine` on a YOLO object detection model is an array of the following type:

```typescript
type RFObjectDetectionPrediction = {
    class?: string;
    confidence?: number;
    bbox?: {
        x: number;
        y: number;
        width: number;
        height: number;
    };
    color?: string;
};
```

### `GazeDetections`

The result of making an inference using the `InferenceEngine` on a Gaze model. An array with the following type:

```typescript
type GazeDetections = {
    leftEye: { x: number; y: number };
    rightEye: { x: number; y: number };
    yaw: number;
    pitch: number;
}[];
```

#### `leftEye.x`

The x position of the left eye as a floating point number between 0 and 1, measured in percentage of the input image width.

#### `leftEye.y`

The y position of the left eye as a floating point number between 0 and 1, measured in percentage of the input image height.

#### `rightEye.x`

The x position of the right eye as a floating point number between 0 and 1, measured in percentage of the input image width.

#### `rightEye.y`

The y position of the right eye as a floating point number between 0 and 1, measured in percentage of the input image height.

#### `yaw`

The yaw of the visual gaze, measured in radians.

#### `pitch`

The pitch of the visual gaze, measured in radians.

### `CVImage`

A class representing an image that can be used for computer vision tasks. It provides various methods to manipulate and convert the image.

#### Constructor

The `CVImage(image)` class constructor initializes a new instance of the class. It accepts one image of one of the following types:

-   `ImageBitmap`: An optional `ImageBitmap` representation of the image.
-   `HTMLImageElement`: An optional `HTMLImageElement` representation of the image.
-   `tf.Tensor`: An optional `tf.Tensor` representation of the image.
-   `tf.Tensor4D`: An optional 4D `tf.Tensor` representation of the image.

#### Methods

##### `bitmap()`

Returns a promise that resolves to an `ImageBitmap` representation of the image. If the image is already a bitmap, it returns the cached bitmap.

##### `tensor()`

Returns a `tf.Tensor` representation of the image. If the image is already a tensor, it returns the cached tensor.

##### `tensor4D()`

Returns a promise that resolves to a 4D `tf.Tensor` representation of the image. If the image is already a 4D tensor, it returns the cached 4D tensor.

##### `array()`

Returns a promise that resolves to a JavaScript array representation of the image. If the image is already a tensor, it converts the tensor to an array.

##### `dims()`

Returns an array containing the dimensions of the image. If the image is a bitmap, it returns `[width, height]`. If the image is a tensor, it returns the shape of the tensor. If the image is an HTML image element, it returns `[width, height]`.

##### `dispose()`

Disposes of the tensor representations of the image to free up memory.

##### `static fromArray(array: tf.TensorLike)`

Creates a new `CVImage` instance from a given tensor-like array.

## Example

A fully functional example can be found in [demo/demo.ts](demo/demo.ts)

## Developing

To start the local development server, execute `npm run dev` to run the demo in development mode, with hot reloading.

To run library tests execute `npm run test`. To run the index.html file in dev mode with vite packaging run `npm run dev`.

## Deployment to NPM registry
Deploy action is WIP
