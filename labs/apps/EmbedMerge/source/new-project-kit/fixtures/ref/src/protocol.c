#include "product_config.h"
void route_ccspt(unsigned port);
void route_modbus(unsigned port);

void process_frame(unsigned port)
{
#if SCI_CHANNELS > 1
    if (port == 1) {
        route_ccspt(port);
        return;
    }
#endif
    route_modbus(port);
}
