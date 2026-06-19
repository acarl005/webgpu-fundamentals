import { mat3 } from "https://webgpufundamentals.org/3rdparty/wgpu-matrix.module.js";

// prettier-ignore
function createFVertices() {
  const vertexData = new Float32Array([
    // left column
    0, 0,
    30, 0,
    0, 150,
    30, 150,
 
    // top rung
    30, 0,
    100, 0,
    30, 30,
    100, 30,
 
    // middle rung
    30, 60,
    70, 60,
    30, 90,
    70, 90,
  ]);
 
  const indexData = new Uint32Array([
    0,  1,  2,    2,  1,  3,  // left column
    4,  5,  6,    6,  5,  7,  // top run
    8,  9, 10,   10,  9, 11,  // middle run
  ]);
 
  return {
    vertexData,
    indexData,
    numVertices: indexData.length,
  };
}

async function main() {
  const adapter = await navigator.gpu?.requestAdapter();
  const device = await adapter?.requestDevice();
  if (!device) {
    console.error("WebGPU not supported");
    return;
  }

  const canvas = document.querySelector("canvas");
  const context = canvas.getContext("webgpu");
  const format = navigator.gpu.getPreferredCanvasFormat();
  context.configure({
    device,
    format,
    alphaMode: "premultiplied",
  });

  const module = device.createShaderModule({
    label: "our hardcoded green triangle shaders",
    code: /* wgsl */ `
			struct Uniforms {
  			color: vec4f,
  			resolution: vec2f,
        matrix: mat3x3f,
			};

			struct Vertex {
				@location(0) position: vec2f,
			};

			struct VSOutput {
				@builtin(position) position: vec4f,
			};

			@group(0) @binding(0) var<uniform> uni: Uniforms;

			@vertex fn vs(vert: Vertex) -> VSOutput {
        let position = (uni.matrix * vec3f(vert.position, 1)).xy;
				var vsOut: VSOutput;
				vsOut.position = vec4f(position, 0.0, 1.0);
				return vsOut;
			}

			@fragment fn fs(vsOut: VSOutput) -> @location(0) vec4f {
				return uni.color;
			}
		`,
  });

  const uniformValues = new Float32Array(4 + 2 + 2 + 12);
  const uniformBuffer = device.createBuffer({
    size: uniformValues.byteLength,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });

  const kColorOffset = 0;
  const kResolutionOffset = 4;
  const kMatrixOffset = 8;

  const colorValue = uniformValues.subarray(kColorOffset, kColorOffset + 4);
  const resolutionValue = uniformValues.subarray(
    kResolutionOffset,
    kResolutionOffset + 2,
  );
  const matrixValue = uniformValues.subarray(kMatrixOffset, kMatrixOffset + 12);

  colorValue.set([Math.random(), Math.random(), Math.random(), 1]);

  const pipeline = device.createRenderPipeline({
    label: "just 2d position",
    layout: "auto",
    vertex: {
      entryPoint: "vs",
      module,
      buffers: [
        {
          arrayStride: 2 * Float32Array.BYTES_PER_ELEMENT,
          attributes: [{ shaderLocation: 0, format: "float32x2", offset: 0 }],
        },
      ],
    },
    fragment: {
      entryPoint: "fs",
      module,
      targets: [{ format }],
    },
  });

  const { vertexData, indexData, numVertices } = createFVertices();

  const vertexBuffer = device.createBuffer({
    size: vertexData.byteLength,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(vertexBuffer, 0, vertexData);

  const indexBuffer = device.createBuffer({
    size: indexData.byteLength,
    usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(indexBuffer, 0, indexData);

  const bindGroup = device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [{ binding: 0, resource: uniformBuffer }],
  });

  const renderPassDesc = {
    label: "demo render pass descriptor",
    colorAttachments: [
      {
        //view: TODO
        loadOp: "clear",
        storeOp: "store",
      },
    ],
  };

  const settings = {
    translation: [0, 0],
    rotation: 0,
    scale: [1, 1],
  };

  function render() {
    renderPassDesc.colorAttachments[0].view = context
      .getCurrentTexture()
      .createView();

    const encoder = device.createCommandEncoder();
    const pass = encoder.beginRenderPass(renderPassDesc);
    pass.setPipeline(pipeline);
    pass.setVertexBuffer(0, vertexBuffer);
    pass.setIndexBuffer(indexBuffer, "uint32");

    resolutionValue.set([canvas.width, canvas.height]);

    const toClipSpace = mat3.multiply(
      mat3.multiply(mat3.scaling([1, -1]), mat3.translation([-1, -1])),
      mat3.scaling([2 / canvas.clientWidth, 2 / canvas.clientHeight]),
    );

    const translationMatrix = mat3.translation(settings.translation);
    const rotationMatrix = mat3.rotation(settings.rotation);
    const scaleMatrix = mat3.scaling(settings.scale);
    let matrix = mat3.multiply(toClipSpace, translationMatrix);
    matrix = mat3.multiply(matrix, rotationMatrix);
    matrix = mat3.multiply(matrix, scaleMatrix);
    matrixValue.set(matrix);
    device.queue.writeBuffer(uniformBuffer, 0, uniformValues);

    pass.setBindGroup(0, bindGroup);
    pass.drawIndexed(numVertices);

    pass.end();

    const commandBuffer = encoder.finish();
    device.queue.submit([commandBuffer]);
  }

  const observer = new ResizeObserver((entries) => {
    for (const entry of entries) {
      const canvas = entry.target;
      const width = entry.contentBoxSize[0].inlineSize;
      const height = entry.contentBoxSize[0].blockSize;
      canvas.width = Math.max(
        1,
        Math.min(width, device.limits.maxTextureDimension2D),
      );
      canvas.height = Math.max(
        1,
        Math.min(height, device.limits.maxTextureDimension2D),
      );
    }
    render();
  });

  observer.observe(canvas);

  const gui = new dat.GUI({});
  gui
    .add(settings.translation, "0", 0, 1000)
    .name("translation.x")
    .onChange(render);
  gui
    .add(settings.translation, "1", 0, 1000)
    .name("translation.y")
    .onChange(render);
  gui.add(settings, "rotation", -2 * Math.PI, 2 * Math.PI).onChange(render);
  gui.add(settings.scale, "0", -5, 5).name("scale.x").onChange(render);
  gui.add(settings.scale, "1", -5, 5).name("scale.y").onChange(render);
}
main();
