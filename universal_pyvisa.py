import pyvisa
from enum import Enum
from typing import Union


class DeviceKind(Enum):
    VISA = "VISA"
    SERIAL_115200_LF = "SERIAL_115200_LF"


class Instrument:
    def __init__(
        self,
        visa_name: str,
        dev_kind: Union["DeviceKind", str],          # e.g. DeviceKind.VISA, DeviceKind.SERIAL_115200_LF
        vendor: str,
        model: str,
        serial: str
    ):
        self.visa_name = visa_name
        # Accept either DeviceKind or a legacy string
        self.dev_kind = dev_kind if isinstance(dev_kind, DeviceKind) else DeviceKind(dev_kind)
        self.vendor = vendor
        self.model = model
        self.serial = serial
        self.alias = None

    def query(self,command):
        rm = pyvisa.ResourceManager()
        with rm.open_resource(self.visa_name) as inst:
            if self.dev_kind == DeviceKind.SERIAL_115200_LF:
                inst.baud_rate = 115200
                inst.data_bits = 8
                inst.parity = pyvisa.constants.Parity.none
                inst.stop_bits = pyvisa.constants.StopBits.one
                inst.write_termination = "\n"
                inst.timeout = 100  # ms
                #inst.read_termination = None  
                
            elif self.dev_kind == DeviceKind.VISA:
                inst.timeout = 100  # ms
                
            else:
                print("ERROR: UNKNOWN DEVICE KIND:",self.alias,':',command)
                return ''

            
            inst.write(command)
            try:
                response = inst.read()
            except pyvisa.errors.VisaIOError as e:
                if e.error_code == pyvisa.constants.StatusCode.error_timeout:
                    response = ''      # no response is OK
                else:
                    raise
            print(self.alias,':',command.replace("\r", "").replace("\n", ""),'-->',response.replace("\r", "").replace("\n", ""))
            return response
    
                
    def write(self, command):
        """Send a command without expecting a response."""
        rm = pyvisa.ResourceManager()
        with rm.open_resource(self.visa_name) as inst:
            if self.dev_kind == DeviceKind.SERIAL_115200_LF:
                inst.baud_rate = 115200
                inst.data_bits = 8
                inst.parity = pyvisa.constants.Parity.none
                inst.stop_bits = pyvisa.constants.StopBits.one
                inst.write_termination = "\n"
                inst.timeout = 100  # ms
            elif self.dev_kind == DeviceKind.VISA:
                inst.timeout = 100  # ms
            else:
                print("ERROR: UNKNOWN DEVICE KIND")
                return

            try:
                inst.write(command)
            except pyvisa.errors.VisaIOError as e:
                # For writes, treat timeouts as non-fatal (some devices behave oddly)
                if e.error_code == pyvisa.constants.StatusCode.error_timeout:
                    return
                raise
            print(self.alias,':',command.replace("\r", "").replace("\n", ""))

    def __str__(self):
        return (
            f"{self.vendor} {self.model} "
            f"(SN: {self.serial}) "
            f"[{self.dev_kind.value}] @ {self.visa_name}"
        )

class upyvisa:
    def __init__(self):
        self.instrument_collection = []
        self.find_instruments()
        
    def find_instruments(self):
        self.instrument_collection = []
        rm = pyvisa.ResourceManager()
        resources = rm.list_resources()
        
        for r in resources:
            print('#######################')
            print("SCAN:", r)
            dev_kind = None
            
            try:
                with rm.open_resource(r) as inst:
                    
                    if r.startswith("ASRL"):
                        dev_kind = DeviceKind.SERIAL_115200_LF
                        inst.baud_rate = 115200
                        inst.data_bits = 8
                        inst.parity = pyvisa.constants.Parity.none
                        inst.stop_bits = pyvisa.constants.StopBits.one
                        inst.timeout = 100  # ms
                        inst.write_termination = "\n"
                        #inst.read_termination = None   
                        inst.write("*IDN?")
                        response = inst.read()
                    else:
                        dev_kind = DeviceKind.VISA
                        inst.timeout = 100  # ms
                        #response = inst.query("*IDN?")
                        inst.write("*IDN?")
                        response = inst.read()
    
                    ## determinate the vendor, model and serial identifier
                    print("     -",response)
                    if len(response) > 8:
                        
                        # Choose delimiter
                        if response.count(",") >= 3:
                            parts = [p.strip() for p in response.split(",") if p.strip()]
                        else:
                            parts = response.split()
                    
                        vendor = parts[0] if len(parts) > 0 else None
                        model = parts[1] if len(parts) > 1 else None
                        serial = " ".join(parts[2:]) if len(parts) > 2 else None
                        x=Instrument(visa_name = r, dev_kind=dev_kind, vendor=vendor, model=model, serial=serial)
                        self.instrument_collection.append(x)
                        print(f"     vendor:{vendor}\n     model:{model}\n     serial:{serial}")
                        continue
    
            except pyvisa.errors.VisaIOError as e:
                # Catch remaining VISA errors (including timeouts on non-serial)
                if e.error_code == pyvisa.constants.StatusCode.error_timeout:
                    print(f"     -{r} -> Timeout")
                else:
                    print(f"     -{r} -> VisaIOError: {e}")
    
            except Exception as e:
                # IMPORTANT: use built-in type() now that we didn't shadow it
                print(f"     -{r} -> {type(e).__name__}: {e}")

    def set_alias(self, alias, vendor, model, serial):
        for instrument in self.instrument_collection:
            if (
                instrument.vendor.strip().casefold() == vendor.strip().casefold()
                and instrument.model.strip().casefold() == model.strip().casefold()
                and instrument.serial.strip().casefold() == serial.strip().casefold()
            ):
                instrument.alias = alias
                return 1
    
        print('Device not found, alias not set!')
        return -1

    def query(self, alias, cmd):
        query_return = ''
        for instrument in self.instrument_collection:
            if instrument.alias != None:
                if instrument.alias.strip().casefold() == alias.strip().casefold():
                   query_return = instrument.query(cmd) + query_return

        return query_return

    def write(self, alias, cmd):
        """Send a command to the instrument identified by alias without expecting a response."""
        for instrument in self.instrument_collection:
            if instrument.alias is not None and instrument.alias.strip().casefold() == alias.strip().casefold():
                instrument.write(cmd)
                return
        print(f"Alias not found: {alias}")
