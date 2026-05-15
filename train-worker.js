/* train-worker.js — on-device model fine-tuning via Web Worker
   Receives: { vectors: number[][], labelIndices: number[] }
   Posts:    { type:'progress', epoch, epochs, loss }
          |  { type:'done', success: bool, error?: string }
*/

importScripts('https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.17.0/dist/tf.min.js');

const NUM_CLASSES = 5;
const EPOCHS = 20;

self.onmessage = async ({ data }) => {
  const { vectors, labelIndices } = data;
  try {
    let model;
    try {
      model = await tf.loadLayersModel('indexeddb://hushh-model');
    } catch {
      model = buildFreshModel(vectors[0].length);
    }

    // Transfer learning: freeze all layers except the output head.
    // Only 160 parameters retrained — prevents catastrophic forgetting on small datasets.
    model.layers.forEach(l => { l.trainable = l.name === 'output'; });

    model.compile({
      optimizer: tf.train.adam(0.005),
      loss: 'categoricalCrossentropy',
      metrics: ['accuracy']
    });

    const xs = tf.tensor2d(vectors);
    const ys = tf.tensor2d(
      labelIndices.map(i => Array.from({ length: NUM_CLASSES }, (_, k) => +(k === i)))
    );

    await model.fit(xs, ys, {
      epochs: EPOCHS,
      shuffle: true,
      callbacks: {
        onEpochEnd: (epoch, logs) =>
          self.postMessage({ type: 'progress', epoch: epoch + 1, epochs: EPOCHS, loss: logs.loss })
      }
    });

    tf.dispose([xs, ys]);
    await model.save('indexeddb://hushh-model');
    self.postMessage({ type: 'done', success: true });

  } catch (err) {
    self.postMessage({ type: 'done', success: false, error: err.message });
  }
};

function buildFreshModel(inputDim) {
  return tf.sequential({
    layers: [
      tf.layers.dense({ inputShape: [inputDim], units: 64, activation: 'relu', name: 'dense_1' }),
      tf.layers.batchNormalization({ name: 'bn_1' }),
      tf.layers.dropout({ rate: 0.3, name: 'drop_1' }),
      tf.layers.dense({ units: 32, activation: 'relu', name: 'dense_2' }),
      tf.layers.dropout({ rate: 0.2, name: 'drop_2' }),
      tf.layers.dense({ units: NUM_CLASSES, activation: 'softmax', name: 'output' })
    ]
  });
}
