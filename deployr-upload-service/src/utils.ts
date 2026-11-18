import fs from "fs";
import path from "path";

const MAX_LENGTH = 5;

export function generate() {
	const subset = "123456789qwertyuiopasdfghjklzxcvbnm";
	let id = "";
  for (let i=0;i<MAX_LENGTH;i++){
    id+=subset[Math.floor(Math.random()*subset.length)]
  }
  return id;
}

export const getAllFiles = (folderPath: string) => {
  let response: string[] = [];

  const allFilesAndFolders = fs.readdirSync(folderPath);
  for(const file of allFilesAndFolders){
    const absolute = path.join(folderPath, file);
    if(fs.statSync(absolute).isDirectory()){
      response.push(...getAllFiles(absolute));
    }
    else{
      response.push(absolute);
    }
  }
  return response;
}
