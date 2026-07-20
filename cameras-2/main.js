import {
  mat4,
  vec3,
} from "https://webgpufundamentals.org/3rdparty/wgpu-matrix.module.js";

// prettier-ignore
function createFVertices() {
  const positions = [
    // left column
     -50,  75,  15,
     -20,  75,  15,
     -50, -75,  15,
     -20, -75,  15,
 
    // top rung
     -20,  75,  15,
      50,  75,  15,
     -20,  45,  15,
      50,  45,  15,
 
    // middle rung
     -20,  15,  15,
      20,  15,  15,
     -20, -15,  15,
      20, -15,  15,
 
    // left column back
     -50,  75, -15,
     -20,  75, -15,
     -50, -75, -15,
     -20, -75, -15,
 
    // top rung back
     -20,  75, -15,
      50,  75, -15,
     -20,  45, -15,
      50,  45, -15,
 
    // middle rung back
     -20,  15, -15,
      20,  15, -15,
     -20, -15, -15,
      20, -15, -15,
  ];
 
  const indices = [
     0,  2,  1,    2,  3,  1,   // left column
     4,  6,  5,    6,  7,  5,   // top run
     8, 10,  9,   10, 11,  9,   // middle run
 
    12, 13, 14,   14, 13, 15,   // left column back
    16, 17, 18,   18, 17, 19,   // top run back
    20, 21, 22,   22, 21, 23,   // middle run back
 
     0,  5, 12,   12,  5, 17,   // top
     5,  7, 17,   17,  7, 19,   // top rung right
     6, 18,  7,   18, 19,  7,   // top rung bottom
     6,  8, 18,   18,  8, 20,   // between top and middle rung
     8,  9, 20,   20,  9, 21,   // middle rung top
     9, 11, 21,   21, 11, 23,   // middle rung right
    10, 22, 11,   22, 23, 11,   // middle rung bottom
    10,  3, 22,   22,  3, 15,   // stem right
     2, 14,  3,   14, 15,  3,   // bottom
     0, 12,  2,   12, 14,  2,   // left
  ];
 
  const quadColors = [
      200,  70, 120,  // left column front
      200,  70, 120,  // top rung front
      200,  70, 120,  // middle rung front
 
       80,  70, 200,  // left column back
       80,  70, 200,  // top rung back
       80,  70, 200,  // middle rung back
 
       70, 200, 210,  // top
      160, 160, 220,  // top rung right
       90, 130, 110,  // top rung bottom
      200, 200,  70,  // between top and middle rung
      210, 100,  70,  // middle rung top
      210, 160,  70,  // middle rung right
       70, 180, 210,  // middle rung bottom
      100,  70, 210,  // stem right
       76, 210, 100,  // bottom
      140, 210,  80,  // left
  ];
 
  const numVertices = indices.length;
  const vertexData = new Float32Array(numVertices * 4); // xyz + color
  const colorData = new Uint8Array(vertexData.buffer);
 
  for (let i = 0; i < indices.length; ++i) {
    const positionNdx = indices[i] * 3;
    const position = positions.slice(positionNdx, positionNdx + 3);
    vertexData.set(position, i * 4);
 
    const quadNdx = (i / 6 | 0) * 3;
    const color = quadColors.slice(quadNdx, quadNdx + 3);
    colorData.set(color, i * 16 + 12);  // set RGB
    colorData[i * 16 + 15] = 255;       // set A
  }
 
  return {
    vertexData,
    numVertices,
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
        matrix: mat4x4f,
			};

			struct Vertex {
				@location(0) position: vec4f,
        @location(1) color: vec4f,
			};

			struct VSOutput {
				@builtin(position) position: vec4f,
        @location(0) color: vec4f,
			};

			@group(0) @binding(0) var<uniform> uni: Uniforms;

			@vertex fn vs(vert: Vertex) -> VSOutput {
				var vsOut: VSOutput;
				vsOut.position = uni.matrix * vert.position;
        vsOut.color = vert.color;
				return vsOut;
			}

			@fragment fn fs(vsOut: VSOutput) -> @location(0) vec4f {
				return vsOut.color;
			}
		`,
  });

  const pipeline = device.createRenderPipeline({
    label: "just 2d position",
    layout: "auto",
    vertex: {
      entryPoint: "vs",
      module,
      buffers: [
        {
          arrayStride: 4 * Float32Array.BYTES_PER_ELEMENT,
          attributes: [
            { shaderLocation: 0, format: "float32x3", offset: 0 },
            { shaderLocation: 1, format: "unorm8x4", offset: 12 },
          ],
        },
      ],
    },
    fragment: {
      entryPoint: "fs",
      module,
      targets: [{ format }],
    },
    primitive: {
      cullMode: "back",
    },
    depthStencil: {
      depthWriteEnabled: true,
      depthCompare: "less",
      format: "depth24plus",
    },
  });

  const { vertexData, numVertices } = createFVertices();

  const vertexBuffer = device.createBuffer({
    size: vertexData.byteLength,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(vertexBuffer, 0, vertexData);

  const numFs = 5;
  const objectInfos = [];
  for (let i = 0; i < numFs; i++) {
    const uniformValues = new Float32Array(16);

    const uniformBuffer = device.createBuffer({
      size: uniformValues.byteLength,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    const kMatrixOffset = 0;

    const matrixValue = uniformValues.subarray(
      kMatrixOffset,
      kMatrixOffset + 16,
    );

    const bindGroup = device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: uniformBuffer }],
    });

    objectInfos.push({
      uniformBuffer,
      uniformValues,
      matrixValue,
      bindGroup,
    });
  }

  /** @type{GPURenderPassDescriptor} */
  const renderPassDesc = {
    label: "demo render pass descriptor",
    colorAttachments: [
      {
        //view: TODO
        loadOp: "clear",
        storeOp: "store",
      },
    ],
    depthStencilAttachment: {
      //view: TODO
      depthClearValue: 1.0,
      depthLoadOp: "clear",
      depthStoreOp: "store",
    },
  };

  const radius = 200;
  const settings = {
    fieldOfView: 100,
    cameraAngle: 0,
  };

  /** @type{GPUTexture} */
  let depthTexture;

  function render() {
    const canvasTexture = context.getCurrentTexture();

    renderPassDesc.colorAttachments[0].view = canvasTexture.createView();

    if (
      !depthTexture ||
      depthTexture.width !== canvasTexture.width ||
      depthTexture.height !== canvasTexture.height
    ) {
      if (depthTexture) {
        depthTexture.destroy();
      }
      depthTexture = device.createTexture({
        size: [canvasTexture.width, canvasTexture.height],
        format: "depth24plus",
        usage: GPUTextureUsage.RENDER_ATTACHMENT,
      });
    }

    renderPassDesc.depthStencilAttachment.view = depthTexture.createView();

    const encoder = device.createCommandEncoder();
    const pass = encoder.beginRenderPass(renderPassDesc);
    pass.setPipeline(pipeline);
    pass.setVertexBuffer(0, vertexBuffer);

    const firstFPosition = [radius, 0, 0];
    const tempMatrix = mat4.rotationY((settings.cameraAngle * Math.PI) / 180);
    mat4.translate(tempMatrix, [0, 0, radius * 1.5], tempMatrix);

    const eye = tempMatrix.slice(12, 15);
    const up = [0, 1, 0];

    // const cameraMatrix = mat4.cameraAim(eye, firstFPosition, up);
    // const viewMatrix = mat4.inverse(cameraMatrix);
    const viewMatrix = mat4.lookAt(eye, firstFPosition, up);

    const aspect = canvas.clientWidth / canvas.clientHeight;
    const projection = mat4.perspective(
      (settings.fieldOfView / 180) * Math.PI,
      aspect,
      1, // zNear
      2000, // zFar
    );
    const viewProjectionMatrix = mat4.multiply(projection, viewMatrix);

    objectInfos.forEach(
      ({ uniformBuffer, uniformValues, matrixValue, bindGroup }, i) => {
        const angle = (i / numFs) * Math.PI * 2;
        const x = Math.cos(angle) * radius;
        const z = Math.sin(angle) * radius;

        mat4.translate(viewProjectionMatrix, [x, 0, z], matrixValue);

        device.queue.writeBuffer(uniformBuffer, 0, uniformValues);

        pass.setBindGroup(0, bindGroup);
        pass.draw(numVertices);
      },
    );

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
  gui.add(settings, "fieldOfView", 1, 179).onChange(render);
  gui.add(settings, "cameraAngle", -360, 360).onChange(render);
}
main();
