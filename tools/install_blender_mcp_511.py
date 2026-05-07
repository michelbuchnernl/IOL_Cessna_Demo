import os
import bpy


addon_path = "/home/michel/AR_VR_Edu_Tool/tools/blender_mcp_addon.py"

if not os.path.exists(addon_path):
    raise FileNotFoundError(addon_path)

bpy.ops.preferences.addon_install(filepath=addon_path, overwrite=True)
bpy.ops.preferences.addon_enable(module="blender_mcp_addon")
bpy.ops.wm.save_userpref()

print("BLENDER_MCP_511_INSTALLED")
