import { mat4 } from "https://webgpufundamentals.org/3rdparty/wgpu-matrix.module.js";

function degToRad(d) {
  return (d * Math.PI) / 180;
}

// prettier-ignore
function createCubeVertices() {
  const vertexData = new Float32Array([
     //  position   |  texture coordinate
     //-------------+----------------------
     // front face     select the top left image
    -1,  1,  1,        0   , 0  ,
    -1, -1,  1,        0   , 0.5,
     1,  1,  1,        0.25, 0  ,
     1, -1,  1,        0.25, 0.5,
     // right face     select the top middle image
     1,  1, -1,        0.25, 0  ,
     1,  1,  1,        0.5 , 0  ,
     1, -1, -1,        0.25, 0.5,
     1, -1,  1,        0.5 , 0.5,
     // back face      select to top right image
     1,  1, -1,        0.5 , 0  ,
     1, -1, -1,        0.5 , 0.5,
    -1,  1, -1,        0.75, 0  ,
    -1, -1, -1,        0.75, 0.5,
    // left face       select the bottom left image
    -1,  1,  1,        0   , 0.5,
    -1,  1, -1,        0.25, 0.5,
    -1, -1,  1,        0   , 1  ,
    -1, -1, -1,        0.25, 1  ,
    // bottom face     select the bottom middle image
     1, -1,  1,        0.25, 0.5,
    -1, -1,  1,        0.5 , 0.5,
     1, -1, -1,        0.25, 1  ,
    -1, -1, -1,        0.5 , 1  ,
    // top face        select the bottom right image
    -1,  1,  1,        0.5 , 0.5,
     1,  1,  1,        0.75, 0.5,
    -1,  1, -1,        0.5 , 1  ,
     1,  1, -1,        0.75, 1  ,
	]);

  const indexData = new Uint16Array([
     0,  1,  2,  2,  1,  3,  // front
     4,  5,  6,  6,  5,  7,  // right
     8,  9, 10, 10,  9, 11,  // back
    12, 13, 14, 14, 13, 15,  // left
    16, 17, 18, 18, 17, 19,  // bottom
    20, 21, 22, 22, 21, 23,  // top
  ]);

  return {
    vertexData,
    indexData,
    numVertices: indexData.length,
  };
}

function numMipLevels(...sizes) {
  const maxSize = Math.max(...sizes);
  return (1 + Math.log2(maxSize)) | 0;
}

/**
 * @param {RequestInfo | URL} input
 * @returns {Promise<ImageBitmap>}
 */
async function loadImageBitmap(input) {
  const resp = await fetch(input);
  const blob = await resp.blob();
  return createImageBitmap(blob, { colorSpaceConversion: "none" });
}

const generateMips = (() => {
  /** @type{GPUSampler} */
  let sampler;
  /** @type{GPUShaderModule} */
  let module;
  /** @type{Record<GPUTextureFormat, GPURenderPipeline>} */
  const pipelineByFormat = {};

  /**
   * @param {GPUDevice} device
   * @param {GPUTexture} texture
   */
  return function generateMips(device, texture) {
    if (!module) {
      module = device.createShaderModule({
        label: "textured quad shaders for mip level generation",
        code: /* wgsl */ `
					struct VSOutput {
						@builtin(position) position: vec4f,
						@location(0) texcoord: vec2f,
					};

					@vertex fn vs(
						@builtin(vertex_index) vertexIndex: u32,
					) -> VSOutput {
						let pos = array(
							// 1st triangle
						  vec2f(0.0, 0.0), // center
							vec2f(1.0, 0.0), // right, center
							vec2f(0.0, 1.0), // center, top

							// 2nd triangle
							vec2f(0.0, 1.0), // center, top
							vec2f(1.0, 0.0), // right, center
							vec2f(1.0, 1.0), // right, top
						);

						var vsOutput: VSOutput;
						let xy = pos[vertexIndex];
						vsOutput.position = vec4f(xy * 2.0 - 1.0, 0.0, 1.0);
						vsOutput.texcoord = vec2f(xy.x, 1.0 - xy.y);
						return vsOutput;
					}

					@group(0) @binding(0) var ourSampler: sampler;
					@group(0) @binding(1) var ourTexture: texture_2d<f32>;

					@fragment fn fs(fsInput: VSOutput) -> @location(0) vec4f {
						return textureSample(ourTexture, ourSampler, fsInput.texcoord);
					}
				`,
      });

      sampler = device.createSampler({
        minFilter: "linear",
      });
    }

    if (!pipelineByFormat[texture.format]) {
      pipelineByFormat[texture.format] = device.createRenderPipeline({
        layout: "auto",
        vertex: {
          module,
        },
        fragment: {
          module,
          targets: [{ format: texture.format }],
        },
      });
    }
    const pipeline = pipelineByFormat[texture.format];

    const encoder = device.createCommandEncoder({
      label: "mip gen encoder",
    });

    for (
      let baseMipLevel = 1;
      baseMipLevel < texture.mipLevelCount;
      baseMipLevel++
    ) {
      const bindGroup = device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: sampler },
          {
            binding: 1,
            resource: texture.createView({
              baseMipLevel: baseMipLevel - 1,
              mipLevelCount: 1,
            }),
          },
        ],
      });

      const renderPassDesc = {
        label: "our basic canvas renderPass",
        colorAttachments: [
          {
            view: texture.createView({
              baseMipLevel,
              mipLevelCount: 1,
            }),
            loadOp: "clear",
            storeOp: "store",
          },
        ],
      };

      const pass = encoder.beginRenderPass(renderPassDesc);
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, bindGroup);
      pass.draw(6);
      pass.end();
    }

    const commandBuffer = encoder.finish();
    device.queue.submit([commandBuffer]);
  };
})();

/**
 * @param {GPUDevice} device
 * @param {GPUTexture} texture
 * @param {GPUCopyExternalImageSourceInfo} source
 */
function copySourceToTexture(device, texture, source, { flipY } = {}) {
  const { width, height } = source;
  device.queue.copyExternalImageToTexture(
    { source, flipY },
    { texture },
    { width, height },
  );

  if (texture.mipLevelCount > 1) {
    generateMips(device, texture);
  }
}

/**
 * @param {GPUDevice} device
 * @param {GPUCopyExternalImageSourceInfo} source
 * @returns {GPUTexture}
 */
function createTextureFromSource(device, source, options = {}) {
  const texture = device.createTexture({
    format: "rgba8unorm",
    mipLevelCount: options.mips ? numMipLevels(source.width, source.height) : 1,
    size: [source.width, source.height],
    usage:
      GPUTextureUsage.TEXTURE_BINDING |
      GPUTextureUsage.COPY_DST |
      GPUTextureUsage.RENDER_ATTACHMENT,
  });
  copySourceToTexture(device, texture, source, options);
  return texture;
}

/**
 * @param {GPUDevice} device
 * @param {RequestInfo | URL} input
 * @returns {Promise<GPUTexture>}
 */
async function createTextureFromImage(device, url, options) {
  const imgBitmap = await loadImageBitmap(url);
  return createTextureFromSource(device, imgBitmap, options);
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
    label: "our hardcoded RGB triangle shaders",
    code: /* wgsl */ `
      struct Uniforms {
        matrix: mat4x4f,
      };

      struct Vertex {
        @location(0) position: vec4f,
        @location(1) texcoord: vec2f,
      };

      struct VSOutput {
        @builtin(position) position: vec4f,
        @location(0) texcoord: vec2f,
      };

      @group(0) @binding(0) var<uniform> uni: Uniforms;
      @group(0) @binding(1) var ourSampler: sampler;
      @group(0) @binding(2) var ourTexture: texture_2d<f32>;

      @vertex fn vs(vert: Vertex) -> VSOutput {
        var vsOut: VSOutput;
        vsOut.position = uni.matrix * vert.position;
        vsOut.texcoord = vert.texcoord;
        return vsOut;
      }

      @fragment fn fs(vsOut: VSOutput) -> @location(0) vec4f {
        return textureSample(ourTexture, ourSampler, vsOut.texcoord);
      }
		`,
  });

  const pipeline = device.createRenderPipeline({
    label: "demo render pipeline",
    layout: "auto",
    vertex: {
      entryPoint: "vs",
      module,
      buffers: [
        {
          arrayStride: (3 + 2) * Float32Array.BYTES_PER_ELEMENT,
          attributes: [
            { shaderLocation: 0, format: "float32x3", offset: 0 }, // position
            {
              shaderLocation: 1,
              format: "float32x2",
              offset: 3 * Float32Array.BYTES_PER_ELEMENT,
            }, // texcoord
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

  const texture = await createTextureFromImage(
    device,
    "https://webgpufundamentals.org/webgpu/resources/images/noodles.jpg",
    { mips: true, flipY: false },
  );

  const sampler = device.createSampler({
    magFilter: "linear",
    minFilter: "linear",
    mipmapFilter: "linear",
  });

  const uniformValues = new Float32Array(16);
  const uniformBuffer = device.createBuffer({
    size: uniformValues.byteLength,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });

  const kMatrixOffset = 0;

  const matrixValue = uniformValues.subarray(kMatrixOffset, kMatrixOffset + 16);

  const { vertexData, indexData, numVertices } = createCubeVertices();
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
    entries: [
      { binding: 0, resource: uniformBuffer },
      { binding: 1, resource: sampler },
      { binding: 2, resource: texture },
    ],
  });

  const renderPassDesc = {
    label: "demo render pass descriptor",
    colorAttachments: [
      {
        //view: TODO
        clearValue: [0.3, 0.3, 0.3, 1.0],
        loadOp: "clear",
        storeOp: "store",
      },
    ],
  };

  let depthTexture;

  function render() {
    const canvasTexture = context.getCurrentTexture();

    renderPassDesc.colorAttachments[0].view = context
      .getCurrentTexture()
      .createView();

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

    renderPassDesc.depthStencilAttachment = {
      view: depthTexture.createView(),
      depthClearValue: 1.0,
      depthLoadOp: "clear",
      depthStoreOp: "store",
    };

    const encoder = device.createCommandEncoder({ label: "our demo encoder" });
    const pass = encoder.beginRenderPass(renderPassDesc);
    pass.setPipeline(pipeline);
    pass.setVertexBuffer(0, vertexBuffer);
    pass.setIndexBuffer(indexBuffer, "uint16");

    const aspect = canvas.clientWidth / canvas.clientHeight;
    mat4.perspective(
      (60 * Math.PI) / 180,
      aspect,
      0.1, // zNear
      10, // zFar
      matrixValue,
    );
    const view = mat4.lookAt(
      [0, 1, 5], // camera position
      [0, 0, 0], // target
      [0, 1, 0], // up
    );
    mat4.multiply(matrixValue, view, matrixValue);
    mat4.rotateX(matrixValue, degToRad(settings.rotation[0]), matrixValue);
    mat4.rotateY(matrixValue, degToRad(settings.rotation[1]), matrixValue);
    mat4.rotateZ(matrixValue, degToRad(settings.rotation[2]), matrixValue);

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
      render();
    }
  });

  observer.observe(canvas);

  const settings = {
    rotation: [20, 25, 0],
  };

  const gui = new dat.GUI({ autoPlace: false });
  Object.assign(gui.domElement.style, {
    position: "absolute",
    top: "0",
    left: "0",
  });
  document.body.appendChild(gui.domElement);
  gui
    .add(settings.rotation, "0", -180, 180, 1)
    .name("rotation.x")
    .onChange(render);
  gui
    .add(settings.rotation, "1", -180, 180, 1)
    .name("rotation.y")
    .onChange(render);
  gui
    .add(settings.rotation, "2", -180, 180, 1)
    .name("rotation.z")
    .onChange(render);
}

main();
